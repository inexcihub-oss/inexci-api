import { Injectable, Logger } from '@nestjs/common';
import { TranscriptionService } from '../transcription/transcription.service';
import { TranscriptionRequest } from '../transcription/transcription.types';
import { AudioEntityExtractor } from './audio-entity-extractor';
import { applyGlossary } from './stt-glossary';
import { SttCacheService } from './stt-cache.service';
import { AudioExtraction } from './stt.types';

/**
 * Limite acima do qual a transcrição literal é substituída por `summary_for_main_agent`
 * no prompt do orchestrator. Conservador (1 turno → no máx ~250 tokens).
 */
const COMPRESS_THRESHOLD_CHARS = 600;

/**
 * Pipeline STT redesenhado (Fase 4 do Blueprint v3).
 *
 * Etapas:
 *   1. SHA256 dedup (Redis 24h).
 *   2. Transcrição via `TranscriptionService` (faster-whisper / openai).
 *   3. Normalização determinística (glossário + post-processing existente).
 *   4. Entity extraction determinística.
 *   5. Semantic compression (cria `summary_for_main_agent` quando longo).
 *
 * NOTA: pré-processamento ffmpeg (mono/16kHz/normalize gain) e VAD
 * adicional do blueprint ficam fora desta primeira iteração — o
 * faster-whisper já roda VAD interno e o overhead de ffmpeg em Node
 * exigiria binário externo. Marcado como FOLLOW-UP no .env (`AI_STT_V3`).
 */
@Injectable()
export class AudioExtractorService {
  private readonly logger = new Logger(AudioExtractorService.name);

  constructor(
    private readonly cache: SttCacheService,
    private readonly transcription: TranscriptionService,
    private readonly entityExtractor: AudioEntityExtractor,
  ) {}

  async extract(input: TranscriptionRequest): Promise<AudioExtraction> {
    const startedAt = Date.now();
    const hash = this.cache.hash(input.audioBuffer);

    const cached = await this.cache.get(hash);
    if (cached) {
      return {
        ...cached,
        total_latency_ms: Date.now() - startedAt,
        source: 'cache',
      };
    }

    const transcribe = await this.transcription.transcribe(input);
    const literal = transcribe.text ?? '';
    const normalized = applyGlossary(literal);
    const { entities, confidence, intent_hint } =
      this.entityExtractor.extract(normalized);

    const summary =
      normalized.length > COMPRESS_THRESHOLD_CHARS
        ? this.buildSummary(normalized, entities)
        : null;

    const extraction: AudioExtraction = {
      hash,
      transcript_normalized: normalized,
      intent_hint,
      entities,
      confidence: {
        transcript: typeof transcribe.confidence === 'number' ? transcribe.confidence : 0.7,
        ...confidence,
      },
      summary_for_main_agent: summary,
      provider: transcribe.provider,
      total_latency_ms: Date.now() - startedAt,
      source: 'live',
    };

    await this.cache.set(hash, extraction);

    this.logger.log(
      `[AI_STT_EXTRACT] hash=${hash.slice(0, 8)} chars=${normalized.length} intent=${intent_hint ?? 'null'} entities=${Object.keys(entities).length} compressed=${summary ? 'yes' : 'no'} latency=${extraction.total_latency_ms}ms`,
    );

    return extraction;
  }

  private buildSummary(
    transcript: string,
    entities: ReturnType<AudioEntityExtractor['extract']>['entities'],
  ): string {
    const head = transcript.slice(0, 220).replace(/\s+/g, ' ').trim();
    const ents: string[] = [];
    if (entities.surgery_request_ref) ents.push(`SC=${entities.surgery_request_ref}`);
    if (entities.patient_name) ents.push(`paciente=${entities.patient_name}`);
    if (entities.hospital_alias) ents.push(`hospital=${entities.hospital_alias}`);
    if (entities.health_plan_alias) ents.push(`convenio=${entities.health_plan_alias}`);
    if (entities.tuss_hint?.length) ents.push(`TUSS=${entities.tuss_hint.join(',')}`);
    if (entities.cid_hint?.length) ents.push(`CID=${entities.cid_hint.join(',')}`);
    if (entities.date_hint) ents.push(`data=${entities.date_hint}`);
    if (entities.monetary_values?.length)
      ents.push(`valor=${entities.monetary_values.join(',')}`);
    const ents_str = ents.length ? ` [${ents.join(' | ')}]` : '';
    return `${head}…${ents_str}`;
  }
}
