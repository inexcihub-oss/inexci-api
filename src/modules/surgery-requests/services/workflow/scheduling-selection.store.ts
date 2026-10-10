import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { PhoneNormalizerService } from 'src/shared/ai/services/orchestrator/phone-normalizer.service';

const KEY_PREFIX = 'sc:scheduling-selection:';

export const SCHEDULING_SELECTION_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class SchedulingSelectionStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulingSelectionStore.name);
  private redis: IORedis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly phoneNormalizer: PhoneNormalizerService,
  ) {}

  onModuleInit(): void {
    this.redis = this.createClient();
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  async remember(phone: string, surgeryRequestId: string): Promise<void> {
    const keys = this.buildKeys(phone);
    const client = this.getClient();
    if (!client || keys.length === 0) return;

    try {
      const pipeline = client.pipeline();
      for (const key of keys) {
        pipeline.set(
          key,
          surgeryRequestId,
          'EX',
          SCHEDULING_SELECTION_TTL_SECONDS,
        );
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        `Falha ao gravar marcador de opções de data (SC ${surgeryRequestId}): ${(err as Error)?.message}`,
      );
    }
  }

  async find(phone: string): Promise<string | null> {
    const keys = this.buildKeys(phone);
    const client = this.getClient();
    if (!client || keys.length === 0) return null;

    try {
      const values = await client.mget(...keys);
      return values.find((value): value is string => !!value) ?? null;
    } catch (err) {
      this.logger.warn(
        `Falha ao ler marcador de opções de data: ${(err as Error)?.message}`,
      );
      return null;
    }
  }

  private buildKeys(phone: string): string[] {
    const { canonicalPhone } = this.phoneNormalizer.normalizeInboundPhone(
      phone ?? '',
    );
    const digits = canonicalPhone.replace(/\D/g, '');
    if (!digits) return [];

    const local =
      digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
    return this.phoneNormalizer
      .expandBrazilianLocalVariants(local)
      .map((variant) => `${KEY_PREFIX}${variant}`);
  }

  private getClient(): IORedis | null {
    return this.redis?.status === 'ready' ? this.redis : null;
  }

  private createClient(): IORedis {
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');
    const tls = this.configService.get<string>('REDIS_TLS') === 'true';

    const client = new IORedis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      ...(username && { username }),
      ...(password && { password }),
      ...(tls && { tls: {} }),
      enableOfflineQueue: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    client.connect().catch((err) => {
      this.logger.warn(
        `Redis indisponível para marcador de opções de data: ${err.message}`,
      );
    });

    return client;
  }
}
