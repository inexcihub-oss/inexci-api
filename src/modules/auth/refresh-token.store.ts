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

export type ConsumeResult =
  | { status: 'valid'; userId: string }
  | { status: 'reused'; userId: string }
  | { status: 'not_found' };

const TOKEN_KEY_PREFIX = 'refresh:tok:';
const USER_KEY_PREFIX = 'refresh:user:';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

const ROTATION_GRACE_SECONDS = 30;

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
    return { status: 'valid', userId };
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
