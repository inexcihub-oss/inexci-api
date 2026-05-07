import {
  TranscriptionProviderName,
  TranscriptionRequest,
  TranscriptionResult,
} from './transcription.types';

export interface TranscriptionProvider {
  readonly name: TranscriptionProviderName;
  transcribe(input: TranscriptionRequest): Promise<TranscriptionResult>;
}
