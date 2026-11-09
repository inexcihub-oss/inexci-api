import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { randomUUID } from 'crypto';

export const DISTRIBUTED_LOCK_PREFIX = 'lock:';
export const DISTRIBUTED_LOCK_DEFAULT_TTL_MS = 30 * 60 * 1000;

export const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly redis: IORedis;

  constructor(configService: ConfigService) {
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = configService.get<number>('REDIS_PORT', 6379);
    const password = configService.get<string>('REDIS_PASSWORD');
    const username = configService.get<string>('REDIS_USERNAME');
    const tls = configService.get<string>('REDIS_TLS') === 'true';

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
        `Redis indisponível para as travas distribuídas: ${err.message}`,
      );
    });
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  async acquire(
    key: string,
    ttlMs: number = DISTRIBUTED_LOCK_DEFAULT_TTL_MS,
  ): Promise<string | null> {
    if (this.redis?.status !== 'ready') {
      throw new ServiceUnavailableException(
        'Serviço de travas indisponível. Tente novamente em instantes.',
      );
    }
    const token = randomUUID();
    const ok = await this.redis.set(
      `${DISTRIBUTED_LOCK_PREFIX}${key}`,
      token,
      'PX',
      ttlMs,
      'NX',
    );
    return ok === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_LUA,
        1,
        `${DISTRIBUTED_LOCK_PREFIX}${key}`,
        token,
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao liberar a trava ${key}; ela expira sozinha: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
