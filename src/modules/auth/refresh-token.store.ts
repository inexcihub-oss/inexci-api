import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

import { hashRefreshToken } from 'src/shared/crypto/refresh-token-hash.util';

/** Resultado de uma tentativa de consumir (rotacionar) um refresh token. */
export type ConsumeResult =
  | { status: 'valid'; userId: string }
  /** Hash existe mas já foi rotacionado/revogado → possível reuso (Fase 3). */
  | { status: 'reused'; userId: string }
  /** Hash não existe (expirado por TTL, nunca emitido, ou já apagado). */
  | { status: 'not_found' };

const TOKEN_KEY_PREFIX = 'refresh:tok:';
const USER_KEY_PREFIX = 'refresh:user:';

/** 7 dias em segundos (TTL = expiração do refresh token). */
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Janela de graça (segundos) após a rotação. Um token já rotacionado, porém
 * reapresentado dentro desta janela, é tratado como **corrida legítima** (duas
 * abas/requests renovando quase ao mesmo tempo) e não como reuso malicioso.
 * Sem isso, a detecção de reuso (Fase 3) geraria falsos positivos e derrubaria
 * sessões válidas.
 */
const ROTATION_GRACE_SECONDS = 30;

/**
 * Lua atômico de consumo. Lê o registro do token e decide:
 *  - inexistente → `not_found`;
 *  - já revogado dentro da janela de graça → `grace` (corrida legítima);
 *  - já revogado fora da janela → `reused` (possível roubo);
 *  - válido → marca `revoked`+`revokedAt` (preservando o TTL) e retorna `valid`.
 *
 * A atomicidade garante que, sob corrida, apenas um consumo "ganha" (valid) e os
 * demais caem em `grace` (dentro da janela).
 */
const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 'not_found'
end
local data = cjson.decode(raw)
local now = tonumber(redis.call('TIME')[1])
local grace = tonumber(ARGV[1])
if data.revoked then
  if data.revokedAt and (now - tonumber(data.revokedAt)) <= grace then
    return 'grace:' .. data.userId
  end
  return 'reused:' .. data.userId
end
data.revoked = true
data.revokedAt = now
local ttl = redis.call('PTTL', KEYS[1])
if ttl and ttl > 0 then
  redis.call('SET', KEYS[1], cjson.encode(data), 'PX', ttl)
else
  redis.call('SET', KEYS[1], cjson.encode(data))
end
return 'valid:' .. data.userId
`;

interface RefreshTokenRecord {
  userId: string;
  createdAt: number;
  revoked?: boolean;
  revokedAt?: number;
}

/**
 * Store de refresh tokens sobre Redis.
 *
 * Persiste apenas o **hash SHA-256** do token (nunca o valor cru). Modelo:
 *  - `refresh:tok:{hash}` → JSON `{ userId, createdAt, revoked? }`, EX 7d.
 *  - `refresh:user:{userId}` → SET dos hashes ativos (revogação em massa).
 *
 * **Fail-closed:** ao contrário do `AiRedisService`, este store NÃO faz fallback
 * in-memory. Se o Redis estiver indisponível, as operações lançam — o refresh
 * falha e o usuário precisa relogar (em múltiplas instâncias um fallback
 * in-memory furaria a revogação).
 */
@Injectable()
export class RefreshTokenStore implements OnModuleDestroy {
  private readonly logger = new Logger(RefreshTokenStore.name);
  private redis: IORedis;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');
    const tls = this.configService.get<string>('REDIS_TLS') === 'true';

    this.redis = new IORedis({
      host,
      port,
      ...(username && { username }),
      ...(password && { password }),
      ...(tls && { tls: {} }),
      enableOfflineQueue: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.redis.connect().catch((err) => {
      this.logger.error(
        `Redis indisponível para refresh tokens: ${err.message}`,
      );
    });
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  /**
   * Retorna o client pronto ou lança (fail-closed). Concentra o guard num
   * único ponto.
   */
  private requireClient(): IORedis {
    if (this.redis?.status !== 'ready') {
      throw new ServiceUnavailableException(
        'Serviço de sessão indisponível. Tente novamente.',
      );
    }
    return this.redis;
  }

  private tokenKey(hash: string): string {
    return `${TOKEN_KEY_PREFIX}${hash}`;
  }

  private userKey(userId: string): string {
    return `${USER_KEY_PREFIX}${userId}`;
  }

  /**
   * Emite um novo refresh token: gera uuid cru, persiste o hash com TTL de 7d e
   * registra o hash no set do usuário. Retorna o token **cru** (vai ao cookie).
   */
  async issue(userId: string): Promise<string> {
    const client = this.requireClient();
    const rawToken = uuidv4();
    const hash = hashRefreshToken(rawToken);
    const record: RefreshTokenRecord = { userId, createdAt: Date.now() };

    await client
      .multi()
      .set(
        this.tokenKey(hash),
        JSON.stringify(record),
        'EX',
        REFRESH_TTL_SECONDS,
      )
      .sadd(this.userKey(userId), hash)
      .expire(this.userKey(userId), REFRESH_TTL_SECONDS)
      .exec();

    return rawToken;
  }

  /**
   * Consome (rotaciona) um refresh token de forma atômica. Marca o token atual
   * como revogado e devolve o resultado para o chamador decidir a reação:
   *  - `valid`: rotacionar (emitir novo via `issue`).
   *  - `reused`: token conhecido porém já revogado → tratar como possível roubo.
   *  - `not_found`: inválido/expirado.
   */
  async consume(rawToken: string): Promise<ConsumeResult> {
    const client = this.requireClient();
    const hash = hashRefreshToken(rawToken);

    const result = (await client.eval(
      CONSUME_LUA,
      1,
      this.tokenKey(hash),
      String(ROTATION_GRACE_SECONDS),
    )) as string;

    if (result === 'not_found') {
      return { status: 'not_found' };
    }
    const [status, userId] = result.split(':');
    if (status === 'reused') {
      return { status: 'reused', userId };
    }
    // `valid` e `grace` (reuso dentro da janela = corrida legítima) seguem o
    // mesmo caminho: emitir um novo token sem disparar revogação de família.
    return { status: 'valid', userId };
  }

  /**
   * Revoga todos os refresh tokens de um usuário (logout, troca de senha ou
   * detecção de reuso). Apaga cada hash e o próprio set.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    const client = this.requireClient();
    const userKey = this.userKey(userId);
    const hashes = await client.smembers(userKey);

    const pipeline = client.multi();
    for (const hash of hashes) {
      pipeline.del(this.tokenKey(hash));
    }
    pipeline.del(userKey);
    await pipeline.exec();
  }
}
