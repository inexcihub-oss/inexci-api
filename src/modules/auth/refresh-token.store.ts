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

interface ConsumedToken {
  userId: string;
  familyId: string | null;
  tokenVersion: number | null;
}

export type ConsumeResult =
  | ({ status: 'valid' } & ConsumedToken)
  | ({ status: 'grace' } & ConsumedToken)
  | ({ status: 'grace_exhausted' } & ConsumedToken)
  | ({ status: 'reused' } & ConsumedToken)
  | { status: 'not_found' };

const TOKEN_KEY_PREFIX = 'refresh:tok:';
const USER_KEY_PREFIX = 'refresh:user:';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ROTATION_GRACE_SECONDS = 30;

export const MAX_GRACE_EXCHANGES = 1;

export const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 'not_found'
end
local data = cjson.decode(raw)
local now = tonumber(redis.call('TIME')[1])
local grace = tonumber(ARGV[1])
local maxGrace = tonumber(ARGV[2])
local family = data.familyId or ''
local tv = ''
if data.tokenVersion ~= nil then
  tv = tostring(data.tokenVersion)
end
local suffix = data.userId .. ':' .. family .. ':' .. tv
local ttl = redis.call('PTTL', KEYS[1])
local function persist()
  if ttl and ttl > 0 then
    redis.call('SET', KEYS[1], cjson.encode(data), 'PX', ttl)
  else
    redis.call('SET', KEYS[1], cjson.encode(data))
  end
end
if data.revoked then
  if data.revokedAt and (now - tonumber(data.revokedAt)) <= grace then
    local used = tonumber(data.graceUsed or 0)
    if used < maxGrace then
      data.graceUsed = used + 1
      persist()
      return 'grace:' .. suffix
    end
    return 'grace_exhausted:' .. suffix
  end
  return 'reused:' .. suffix
end
data.revoked = true
data.revokedAt = now
data.graceUsed = 0
persist()
return 'valid:' .. suffix
`;

interface RefreshTokenRecord {
  userId: string;
  familyId: string;
  tokenVersion: number;
  createdAt: number;
  revoked?: boolean;
  revokedAt?: number;
  graceUsed?: number;
}

const STATUS_CONHECIDOS = new Set([
  'valid',
  'grace',
  'grace_exhausted',
  'reused',
]);

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

  async issue(
    userId: string,
    tokenVersion: number,
    familyId?: string | null,
  ): Promise<string> {
    const client = this.requireClient();
    const rawToken = uuidv4();
    const hash = hashRefreshToken(rawToken);
    const record: RefreshTokenRecord = {
      userId,
      familyId: familyId || uuidv4(),
      tokenVersion,
      createdAt: Date.now(),
    };

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

  async consume(rawToken: string): Promise<ConsumeResult> {
    const client = this.requireClient();
    const hash = hashRefreshToken(rawToken);

    const result = (await client.eval(
      CONSUME_LUA,
      1,
      this.tokenKey(hash),
      String(ROTATION_GRACE_SECONDS),
      String(MAX_GRACE_EXCHANGES),
    )) as string;

    const [status, userId, familyId, tokenVersion] = result.split(':');
    if (!STATUS_CONHECIDOS.has(status) || !userId) {
      return { status: 'not_found' };
    }
    return {
      status: status as 'valid' | 'grace' | 'grace_exhausted' | 'reused',
      userId,
      familyId: familyId || null,
      tokenVersion: tokenVersion ? Number(tokenVersion) : null,
    };
  }

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
