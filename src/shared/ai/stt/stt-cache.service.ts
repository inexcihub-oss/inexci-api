import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiRedisService } from '../services/ai-redis.service';
import { AudioExtraction } from './stt.types';

const TTL_SECONDS = 24 * 60 * 60;

/**
 * Cache de resultados STT por SHA256 do buffer de áudio.
 *
 * Hit-rate esperado: 5-15% do tráfego (reenvios acidentais quando o
 * usuário aperta enviar duas vezes, ou quando o webhook é re-entregue).
 * Mesmo um hit é "free" — economiza STT + entity extraction.
 */
@Injectable()
export class SttCacheService {
  private readonly logger = new Logger(SttCacheService.name);

  constructor(private readonly redis: AiRedisService) {}

  hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async get(hash: string): Promise<AudioExtraction | null> {
    const value = await this.redis.cacheGet<AudioExtraction>(`stt:${hash}`);
    if (value) {
      this.logger.log(`[AI_STT_CACHE] hit hash=${hash.slice(0, 8)}…`);
      return { ...value, source: 'cache' };
    }
    return null;
  }

  async set(hash: string, value: AudioExtraction): Promise<void> {
    await this.redis.cacheSet(`stt:${hash}`, value, TTL_SECONDS);
  }
}
