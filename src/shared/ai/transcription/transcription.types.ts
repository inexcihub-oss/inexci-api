export type TranscriptionProviderName = 'faster_whisper' | 'openai';

export interface TranscriptionRequest {
  audioBuffer: Buffer;
  mimeType: string;
  fileName?: string;
  language?: string;
  durationSeconds?: number | null;
}

export interface TranscriptionResult {
  text: string;
  provider: TranscriptionProviderName;
  latencyMs: number;
  language?: string | null;
  confidence?: number | null;
  durationSeconds?: number | null;
  fallbackUsed?: boolean;
}
