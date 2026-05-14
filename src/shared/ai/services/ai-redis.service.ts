import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

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
    } catch (err: any) {
      this.logger.warn(`Redis não configurado: ${err.message}`);
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  get isAvailable(): boolean {
    return this.redis?.status === 'ready';
  }

  /**
   * Retorna o client Redis se estiver pronto, ou `null` caso contrário.
   * Concentra o narrowing em um único ponto para que callers fiquem
   * compatíveis com `strictNullChecks`.
   */
  private getClient(): IORedis | null {
    return this.redis?.status === 'ready' ? this.redis : null;
  }

  // T32: Rate limit via INCR + EXPIRE
  async checkRateLimit(
    phone: string,
    max: number,
    windowSec: number,
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client) return true; // fallback: sem limite
    const key = `${KEY_PREFIX}rl:${phone}`;
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSec);
    return count <= max;
  }

  // T33: Cache genérico com TTL
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

  async cacheSet(key: string, value: any, ttlSeconds: number): Promise<void> {
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

  // T34: Flags com TTL nativo
  async setFlag(key: string, ttlSeconds: number): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    await client.set(`${KEY_PREFIX}${key}`, '1', 'EX', ttlSeconds);
  }

  async hasFlag(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;
    const val = await client.get(`${KEY_PREFIX}${key}`);
    return val !== null;
  }
}
