/**
 * Tipos do pipeline STT redesenhado (Fase 4 do Blueprint v3).
 *
 * Distinção:
 *   - `TranscriptionResult` (já existe em `transcription/transcription.types.ts`)
 *     é o output bruto do provider (faster-whisper / openai whisper).
 *   - `AudioExtraction` é o output ENRIQUECIDO desta camada: transcript
 *     normalizado + entidades + intent hint + summary semântico.
 */

export interface AudioExtractionEntities {
  patient_name?: string | null;
  hospital_alias?: string | null;
  health_plan_alias?: string | null;
  doctor_crm?: string | null;
  tuss_hint?: string[];
  cid_hint?: string[];
  date_hint?: string | null;
  monetary_values?: number[];
  surgery_request_ref?: string | null;
}

export interface AudioExtractionConfidence {
  transcript: number;
  patient_name?: number;
  hospital_alias?: number;
  tuss_hint?: number;
  cid_hint?: number;
  date_hint?: number;
}

export interface AudioExtraction {
  /** SHA256 do buffer original — usado para dedup. */
  hash: string;
  /** Transcrição literal (após normalização lexical determinística). */
  transcript_normalized: string;
  /** Hint determinístico de intent (vem das keywords do classifier). */
  intent_hint: string | null;
  entities: AudioExtractionEntities;
  confidence: AudioExtractionConfidence;
  /**
   * Resumo curto (1-2 linhas) substituto da transcrição quando longa.
   * Quando `null`, o orchestrator usa `transcript_normalized` direto.
   */
  summary_for_main_agent: string | null;
  /** Provider que gerou a transcrição base. */
  provider: string;
  /** Latência total (download + STT + extraction). */
  total_latency_ms: number;
  /** Origem da extração (cache vs live). */
  source: 'cache' | 'live';
}

export interface SttGlossary {
  tld_phrases: Record<string, string>;
  medical_corrections: Record<string, string>;
  hospital_aliases: Array<{
    spoken: string[];
    canonical_hint: string;
  }>;
}
