import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiDocCacheRepository } from '../../../database/repositories/ai-doc-cache.repository';
import { AiDocCache } from '../../../database/entities/ai-doc-cache.entity';

/**
 * Cache de OCR/classificação por SHA256 (Fase 5 do Blueprint v3).
 *
 * `getOrSet` é o caminho feliz: chama o produtor se não tiver cache
 * e persiste ambos `ocr_text` (já tokenizado por PII) e
 * `classification`/`extraction`. Mesmo sob falha de DB, devolve o
 * resultado do produtor — falha-segura.
 */
export interface DocCacheRecord {
  sha256: string;
  ocrText: string | null;
  ocrConfidence: number | null;
  classification: Record<string, unknown> | null;
  extraction: Record<string, unknown> | null;
  source: 'cache' | 'live';
}

@Injectable()
export class DocCacheService {
  private readonly logger = new Logger(DocCacheService.name);

  constructor(private readonly repo: AiDocCacheRepository) {}

  hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async get(sha256: string): Promise<DocCacheRecord | null> {
    try {
      const row = await this.repo.findByHash(sha256);
      if (!row) return null;
      this.logger.log(`[AI_DOC_CACHE] hit hash=${sha256.slice(0, 8)}…`);
      this.repo.incrementHit(sha256).catch((err) => {
        this.logger.warn(
          `[AI_DOC_CACHE] falha ao incrementar hit_count: ${err?.message || err}`,
        );
      });
      return {
        sha256: row.sha256,
        ocrText: row.ocrText,
        ocrConfidence: row.ocrConfidence,
        classification: row.classification,
        extraction: row.extraction,
        source: 'cache',
      };
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_CACHE] falha ao consultar cache hash=${sha256.slice(0, 8)}: ${err?.message || err}`,
      );
      return null;
    }
  }

  async set(
    input: Omit<AiDocCache, 'createdAt' | 'lastHitAt' | 'hitCount'>,
  ): Promise<void> {
    try {
      await this.repo.save({
        ...input,
        lastHitAt: new Date(),
        hitCount: 0,
      });
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_CACHE] falha ao gravar cache hash=${input.sha256?.slice(0, 8)}: ${err?.message || err}`,
      );
    }
  }
}
