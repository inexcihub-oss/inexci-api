import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AiRedisService } from '../ai-redis.service';
import {
  AudioCompressionResult,
  SemanticInputEnvelope,
} from '../../contracts/agentic-architecture.contracts';
import { TranscriptionResult } from '../../transcription/transcription.types';

interface CachedAudioTranscription {
  fingerprint: string;
  transcription: TranscriptionResult;
}

@Injectable()
export class AudioPipelineService {
  constructor(
    private readonly aiRedis: AiRedisService,
    private readonly configService: ConfigService,
  ) {}

  buildFingerprint(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async getCachedTranscription(
    fingerprint: string,
  ): Promise<TranscriptionResult | null> {
    const cached = await this.aiRedis.cacheGet<CachedAudioTranscription>(
      this.buildCacheKey(fingerprint),
    );
    return cached?.transcription ?? null;
  }

  async setCachedTranscription(
    fingerprint: string,
    transcription: TranscriptionResult,
  ): Promise<void> {
    await this.aiRedis.cacheSet(
      this.buildCacheKey(fingerprint),
      { fingerprint, transcription } satisfies CachedAudioTranscription,
      this.getCacheTtlSeconds(),
    );
  }

  compressTranscription(input: {
    fingerprint: string;
    transcription: TranscriptionResult;
  }): AudioCompressionResult {
    const normalized = (input.transcription.text || '').replace(/\s+/g, ' ').trim();
    const entities = this.extractEntities(normalized);
    const semanticTranscript = this.compressText(normalized);
    const inferredIntent = this.inferIntent(normalized);
    const missingSegments = normalized.includes('...') ? ['speech_gap'] : [];

    return {
      version: '1.0',
      fingerprint: input.fingerprint,
      provider: input.transcription.provider,
      language: input.transcription.language ?? null,
      confidence: input.transcription.confidence ?? null,
      transcriptLength: normalized.length,
      semanticTranscript,
      normalizedTranscript: normalized,
      extractedEntities: entities,
      inferredIntent,
      missingSegments,
    };
  }

  toSemanticInput(
    textInput: string,
    compression: AudioCompressionResult | null,
  ): SemanticInputEnvelope {
    const normalizedText = textInput.trim()
      ? textInput.trim()
      : compression?.semanticTranscript || '';

    return {
      version: '1.0',
      source: textInput.trim()
        ? compression
          ? 'text+audio'
          : 'text'
        : 'audio',
      normalizedText,
      rawText: compression?.normalizedTranscript || textInput || null,
      entities: compression?.extractedEntities || [],
      confidence: compression?.confidence ?? 0.7,
      missingSegments: compression?.missingSegments || [],
      hints: compression?.inferredIntent ? [compression.inferredIntent] : [],
    };
  }

  buildUserInput(input: {
    textInput: string;
    compression: AudioCompressionResult | null;
  }): string {
    const rawText = input.textInput.trim();
    const semanticText = input.compression?.semanticTranscript?.trim() || '';

    if (rawText && semanticText) {
      return `${rawText}\n\nResumo semantico do audio: ${semanticText}`;
    }
    if (rawText) return rawText;
    return semanticText;
  }

  private compressText(text: string): string {
    if (!text) return '';
    if (text.length <= this.getCompressionThresholdChars()) return text;
    const segments = text
      .split(/[.!?]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments.slice(0, 4).join('. ') + '.';
  }

  private inferIntent(text: string): string | null {
    const lower = text.toLowerCase();
    if (/(criar|nova).*(sc|solicit)/.test(lower)) return 'create_sc';
    if (/agend/.test(lower)) return 'scheduling';
    if (/fatur|fatura/.test(lower)) return 'invoice';
    if (/contest/.test(lower)) return 'contestation';
    return null;
  }

  private extractEntities(text: string): SemanticInputEnvelope['entities'] {
    const entities: SemanticInputEnvelope['entities'] = [];
    const pushMatches = (
      type: SemanticInputEnvelope['entities'][number]['type'],
      regex: RegExp,
      confidence: number,
    ) => {
      for (const match of text.matchAll(regex)) {
        const value = match[0]?.trim();
        if (!value) continue;
        entities.push({ type, value, confidence });
      }
    };

    pushMatches('email', /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, 0.95);
    pushMatches('phone', /\b\d{10,13}\b/g, 0.9);
    pushMatches('cid', /\b[A-Z]\d{2}(?:\.\d)?\b/g, 0.85);
    pushMatches('tuss', /\b\d{8,9}\b/g, 0.75);

    return entities.slice(0, 12);
  }

  private buildCacheKey(fingerprint: string): string {
    return `audio-pipeline:${fingerprint}`;
  }

  private getCacheTtlSeconds(): number {
    return this.configService.get<number>('AI_AUDIO_CACHE_TTL_SECONDS', 24 * 60 * 60);
  }

  private getCompressionThresholdChars(): number {
    return this.configService.get<number>('AI_AUDIO_COMPRESSION_MAX_CHARS', 240);
  }
}
