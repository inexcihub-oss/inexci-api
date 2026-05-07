import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionProvider } from '../transcription.provider';
import {
  TranscriptionRequest,
  TranscriptionResult,
} from '../transcription.types';

@Injectable()
export class FasterWhisperProvider implements TranscriptionProvider {
  readonly name = 'faster_whisper' as const;

  constructor(private readonly configService: ConfigService) {}

  async transcribe(input: TranscriptionRequest): Promise<TranscriptionResult> {
    const baseUrl = this.configService
      .get<string>('AI_STT_FASTER_WHISPER_URL', 'http://stt-service:8000')
      .replace(/\/+$/, '');

    const timeoutMs = this.configService.get<number>(
      'AI_TRANSCRIPTION_TIMEOUT_MS',
      30000,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${baseUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'content-type': input.mimeType,
          'x-file-name': input.fileName || 'audio.ogg',
          'x-language': input.language || 'pt',
        },
        body: input.audioBuffer as unknown as BodyInit,
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        throw new Error(
          `faster-whisper retornou status ${response.status}${details ? `: ${details}` : ''}`,
        );
      }

      const payload = (await response.json()) as {
        text?: string;
        language?: string;
        confidence?: number;
        durationSeconds?: number;
      };

      if (!payload?.text || !payload.text.trim()) {
        throw new Error('faster-whisper retornou transcrição vazia.');
      }

      return {
        text: payload.text,
        provider: this.name,
        latencyMs: Date.now() - startedAt,
        language: payload.language || input.language || null,
        confidence:
          typeof payload.confidence === 'number' ? payload.confidence : null,
        durationSeconds:
          typeof payload.durationSeconds === 'number'
            ? payload.durationSeconds
            : (input.durationSeconds ?? null),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
