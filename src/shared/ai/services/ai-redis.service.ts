import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { errorMessage } from '../../utils/error-message.util';

const KEY_PREFIX = 'ai:';

@Injectable()
export class AiRedisService implements OnModuleDestroy {
  private readonly logger = new Logger(AiRedisService.name);
  private redis: IORedis | null = null;

  constructor(private readonly configService: ConfigService) {
    try {
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
        this.logger.warn(
          `Redis indisponível (fallback in-memory): ${err.message}`,
        );
        this.redis = null;
      });
    } catch (err) {
      this.logger.warn(`Redis não configurado: ${errorMessage(err)}`);
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  get isAvailable(): boolean {
    return this.redis?.status === 'ready';
  }

  private getClient(): IORedis | null {
    return this.redis?.status === 'ready' ? this.redis : null;
  }

  async checkRateLimit(
    phone: string,
    max: number,
    windowSec: number,
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client) return true;
    const key = `${KEY_PREFIX}rl:${phone}`;
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSec);
    return count <= max;
  }

  async cacheGet<T>(key: string): Promise<T | null> {
    const client = this.getClient();
    if (!client) return null;
    const raw = await client.get(`${KEY_PREFIX}${key}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async cacheSet(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    await client.set(
      `${KEY_PREFIX}${key}`,
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }

  async cacheDelete(key: string): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    await client.del(`${KEY_PREFIX}${key}`);
  }
}
