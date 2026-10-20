import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { createHash } from 'crypto';

export const LOGIN_MAX_FALHAS = 10;
export const LOGIN_JANELA_SEGUNDOS = 15 * 60;
export const LOGIN_BLOQUEIO_SEGUNDOS = 15 * 60;

export const RECOVERY_MAX_EMISSOES = 5;
export const RECOVERY_JANELA_EMISSAO_SEGUNDOS = 24 * 60 * 60;

export const RECOVERY_MAX_FALHAS = 10;
export const RECOVERY_JANELA_FALHAS_SEGUNDOS = 24 * 60 * 60;

export const MFA_MAX_FALHAS = 5;
export const MFA_JANELA_SEGUNDOS = 15 * 60;
export const MFA_BLOQUEIO_SEGUNDOS = 15 * 60;

const PREFIXO = 'auth:limit:';

const INCREMENTAR_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return n
`;

export function normalizarEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

function chaveDoEmail(email: string): string {
  return createHash('sha256').update(normalizarEmail(email)).digest('hex');
}

@Injectable()
export class AuthAttemptLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(AuthAttemptLimiter.name);
  private readonly redis: IORedis;
  private readonly desligado: boolean;

  constructor(private readonly configService: ConfigService) {
    this.desligado = this.configService.get<string>('NODE_ENV') === 'test';
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

    this.redis.connect().catch((err: Error) => {
      this.logger.error(
        `Redis indisponível para o limite de tentativas: ${err.message}`,
      );
    });
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  private cliente(): IORedis | null {
    if (this.desligado) return null;
    if (this.redis?.status !== 'ready') {
      this.logger.warn(
        '[AUTH_LIMITER] Redis indisponível; limite por conta não aplicado nesta requisição.',
      );
      return null;
    }
    return this.redis;
  }

  private async incrementar(
    cliente: IORedis,
    chave: string,
    janelaSegundos: number,
  ): Promise<number> {
    const n = await cliente.eval(
      INCREMENTAR_LUA,
      1,
      chave,
      String(janelaSegundos),
    );
    return Number(n);
  }

  private async contador(cliente: IORedis, chave: string): Promise<number> {
    const valor = await cliente.get(chave);
    return valor ? Number(valor) : 0;
  }

  private async seguro<T>(fallback: T, fn: (c: IORedis) => Promise<T>) {
    const c = this.cliente();
    if (!c) return fallback;
    try {
      return await fn(c);
    } catch (err) {
      this.logger.warn(
        `[AUTH_LIMITER] Falha ao consultar o Redis: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  isLoginLocked(email: string): Promise<boolean> {
    const chave = `${PREFIXO}login:lock:${chaveDoEmail(email)}`;
    return this.seguro(false, async (c) => (await c.exists(chave)) > 0);
  }

  registerLoginFailure(email: string): Promise<void> {
    const id = chaveDoEmail(email);
    const falhas = `${PREFIXO}login:fail:${id}`;
    const bloqueio = `${PREFIXO}login:lock:${id}`;
    return this.seguro(undefined, async (c) => {
      const n = await this.incrementar(c, falhas, LOGIN_JANELA_SEGUNDOS);
      if (n >= LOGIN_MAX_FALHAS) {
        await c
          .multi()
          .set(bloqueio, '1', 'EX', LOGIN_BLOQUEIO_SEGUNDOS)
          .del(falhas)
          .exec();
      }
    });
  }

  clearLoginFailures(email: string): Promise<void> {
    const chave = `${PREFIXO}login:fail:${chaveDoEmail(email)}`;
    return this.seguro(undefined, async (c) => {
      await c.del(chave);
    });
  }

  tryConsumeRecoveryIssue(userId: string): Promise<boolean> {
    const chave = `${PREFIXO}recovery:issued:${userId}`;
    return this.seguro(true, async (c) => {
      const n = await this.incrementar(
        c,
        chave,
        RECOVERY_JANELA_EMISSAO_SEGUNDOS,
      );
      return n <= RECOVERY_MAX_EMISSOES;
    });
  }

  isRecoveryValidationLocked(email: string): Promise<boolean> {
    const chave = `${PREFIXO}recovery:fail:${chaveDoEmail(email)}`;
    return this.seguro(
      false,
      async (c) => (await this.contador(c, chave)) >= RECOVERY_MAX_FALHAS,
    );
  }

  registerRecoveryFailure(email: string): Promise<void> {
    const chave = `${PREFIXO}recovery:fail:${chaveDoEmail(email)}`;
    return this.seguro(undefined, async (c) => {
      await this.incrementar(c, chave, RECOVERY_JANELA_FALHAS_SEGUNDOS);
    });
  }

  isMfaLocked(userId: string): Promise<boolean> {
    const chave = `${PREFIXO}mfa:lock:${userId}`;
    return this.seguro(false, async (c) => (await c.exists(chave)) > 0);
  }

  registerMfaFailure(userId: string): Promise<boolean> {
    const falhas = `${PREFIXO}mfa:fail:${userId}`;
    const bloqueio = `${PREFIXO}mfa:lock:${userId}`;
    return this.seguro(false, async (c) => {
      const n = await this.incrementar(c, falhas, MFA_JANELA_SEGUNDOS);
      if (n >= MFA_MAX_FALHAS) {
        await c
          .multi()
          .set(bloqueio, '1', 'EX', MFA_BLOQUEIO_SEGUNDOS)
          .del(falhas)
          .exec();
        return true;
      }
      return false;
    });
  }

  clearMfaFailures(userId: string): Promise<void> {
    const chave = `${PREFIXO}mfa:fail:${userId}`;
    return this.seguro(undefined, async (c) => {
      await c.del(chave);
    });
  }
}
