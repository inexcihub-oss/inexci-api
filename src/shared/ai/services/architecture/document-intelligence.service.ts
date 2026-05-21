import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  DocumentExtractionResult,
  RuntimePendingDocument,
} from '../../contracts/agentic-architecture.contracts';
import { DocumentClassification } from '../../ocr/document-classifier.types';
import { AiRedisService } from '../ai-redis.service';
import { AiDocCacheRepository } from '../../../../database/repositories/ai-doc-cache.repository';
import { DocumentExtractionEngineService } from '../../ocr/parsers/document-extraction-engine.service';

interface CachedDocumentExtraction {
  fingerprint: string;
  result: DocumentExtractionResult;
}

@Injectable()
export class DocumentIntelligenceService {
  constructor(
    private readonly aiRedis: AiRedisService,
    private readonly configService: ConfigService,
    @Optional() private readonly docCacheRepo?: AiDocCacheRepository,
    @Optional()
    private readonly extractionEngine?: DocumentExtractionEngineService,
  ) {}

  buildFingerprint(buffer: Buffer, mimeType: string, intent?: string): string {
    return createHash('sha256')
      .update(buffer)
      .update('|')
      .update(mimeType || '')
      .update('|')
      .update(intent || '')
      .digest('hex');
  }

  async getCachedExtraction(
    fingerprint: string,
  ): Promise<DocumentExtractionResult | null> {
    const cached = await this.aiRedis.cacheGet<CachedDocumentExtraction>(
      this.cacheKey(fingerprint),
    );
    if (cached?.result) return cached.result;

    const persisted = this.docCacheRepo
      ? // eslint-disable-next-line local-rules/no-as-any -- filtro parcial no repository base
        await this.docCacheRepo.findOne({ fingerprint } as any)
      : null;
    if (!persisted) return null;
    // eslint-disable-next-line local-rules/no-as-any -- update parcial no repository base
    await this.docCacheRepo?.update?.(persisted.id, {
      hitCount: (persisted.hitCount || 0) + 1,
    } as any);
    return persisted.payload as unknown as DocumentExtractionResult;
  }

  async setCachedExtraction(
    fingerprint: string,
    result: DocumentExtractionResult,
  ): Promise<void> {
    await this.aiRedis.cacheSet(
      this.cacheKey(fingerprint),
      { fingerprint, result } satisfies CachedDocumentExtraction,
      this.configService.get<number>('AI_DOC_CACHE_TTL_SECONDS', 24 * 60 * 60),
    );
    const existing = this.docCacheRepo
      ? // eslint-disable-next-line local-rules/no-as-any -- filtro parcial no repository base
        await this.docCacheRepo.findOne({ fingerprint } as any)
      : null;
    if (existing) {
      // eslint-disable-next-line local-rules/no-as-any -- update parcial no repository base
      await this.docCacheRepo?.update?.(existing.id, {
        extractionSource:
          result.classification?.model?.includes('vision') ||
          result.reasons.includes('vision_fallback')
            ? 'vision'
            : result.reasons.includes('cheap_residual')
              ? 'cheap_llm'
              : 'ocr_only',
        payload: result as unknown as Record<string, unknown>,
      } as any);
      return;
    }
    // eslint-disable-next-line local-rules/no-as-any -- create parcial no repository base
    await this.docCacheRepo?.create?.({
      fingerprint,
      contentType:
        result.classification?.suggestedDocumentType ||
        'application/octet-stream',
      intent: result.classification?.kind || null,
      extractionSource:
        result.classification?.model?.includes('vision') ||
        result.reasons.includes('vision_fallback')
          ? 'vision'
          : result.reasons.includes('cheap_residual')
            ? 'cheap_llm'
            : 'ocr_only',
      payload: result as unknown as Record<string, unknown>,
    } as any);
  }

  buildExtractionResult(input: {
    fingerprint: string;
    classification: DocumentClassification | null;
    ocrConfidence: number | null;
    textLength: number;
    usedVisionFallback: boolean;
    reasons: string[];
    rawText?: string;
  }): DocumentExtractionResult {
    const enrichedClassification = this.extractionEngine?.enrich
      ? this.extractionEngine.enrich(input.rawText || '', input.classification)
      : input.classification;
    const fieldConfidence = this.computeFieldConfidence(
      enrichedClassification,
      input.ocrConfidence,
    );
    const globalConfidence = this.computeGlobalConfidence(
      enrichedClassification,
      input.ocrConfidence,
      input.usedVisionFallback,
    );

    return {
      version: '1.0',
      fingerprint: input.fingerprint,
      classification: enrichedClassification,
      textLength: input.textLength,
      ocrConfidence: input.ocrConfidence,
      globalConfidence,
      fieldConfidence,
      selectiveVisionRecommended:
        globalConfidence < 0.72 || Object.keys(fieldConfidence).length === 0,
      reasons: input.reasons,
    };
  }

  buildPendingDocumentState(input: {
    pending: {
      storagePath: string;
      fileName: string;
      contentType: string | null;
      intent?: string | null;
      classification?: DocumentClassification | null;
      expiresAt?: number;
    } | null;
    fingerprint?: string | null;
  }): RuntimePendingDocument | null {
    if (!input.pending) return null;
    return {
      storagePath: input.pending.storagePath,
      fileName: input.pending.fileName,
      contentType: input.pending.contentType || 'application/octet-stream',
      intent: input.pending.intent || null,
      classification: input.pending.classification || null,
      fingerprint: input.fingerprint || null,
      expiresAt: input.pending.expiresAt ?? null,
    };
  }

  shouldTryVisionFallback(input: {
    ocrUnusable: boolean;
    classifierError: boolean;
    classifierConfidenceLow: boolean;
    classifierKindUnknown: boolean;
    classifierExtractedEmpty: boolean;
    isVisionSupported: boolean;
  }): boolean {
    return (
      input.isVisionSupported &&
      (input.ocrUnusable ||
        input.classifierError ||
        input.classifierConfidenceLow ||
        input.classifierKindUnknown ||
        input.classifierExtractedEmpty)
    );
  }

  private computeGlobalConfidence(
    classification: DocumentClassification | null,
    ocrConfidence: number | null,
    usedVisionFallback: boolean,
  ): number {
    const classifierConfidence = classification?.confidence ?? 0;
    const ocrWeight =
      typeof ocrConfidence === 'number' ? ocrConfidence * 0.4 : 0.2;
    const classifierWeight = classifierConfidence * 0.6;
    const fallbackPenalty = usedVisionFallback ? -0.05 : 0;
    return Math.max(
      0,
      Math.min(
        1,
        Number((ocrWeight + classifierWeight + fallbackPenalty).toFixed(3)),
      ),
    );
  }

  private computeFieldConfidence(
    classification: DocumentClassification | null,
    ocrConfidence: number | null,
  ): Record<string, number> {
    if (!classification) return {};
    const base =
      typeof ocrConfidence === 'number'
        ? ocrConfidence
        : classification.confidence;
    const extracted = classification.extracted || {};
    const entries = Object.entries(extracted).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    });
    return Object.fromEntries(
      entries.map(([key]) => [key, Number(Math.min(1, base).toFixed(3))]),
    );
  }

  private cacheKey(fingerprint: string): string {
    return `doc-intelligence:${fingerprint}`;
  }
}
