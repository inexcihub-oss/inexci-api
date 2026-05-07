import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionProvider } from '../transcription.provider';
import {
  TranscriptionRequest,
  TranscriptionResult,
} from '../transcription.types';

@Injectable()
export class OpenaiWhisperProvider implements TranscriptionProvider {
  readonly name = 'openai' as const;

  constructor(private readonly configService: ConfigService) {}

  async transcribe(input: TranscriptionRequest): Promise<TranscriptionResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY', '').trim();
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY não configurada para fallback de transcrição.',
      );
    }

    const endpoint = this.configService.get<string>(
      'AI_STT_OPENAI_URL',
      'https://api.openai.com/v1/audio/transcriptions',
    );

    const model = this.configService.get<string>(
      'AI_STT_OPENAI_MODEL',
      'whisper-1',
    );

    const formData = new FormData();
    const audioBinary = Uint8Array.from(input.audioBuffer);
    formData.append('model', model);
    formData.append('language', input.language || 'pt');
    formData.append(
      'file',
      new Blob([audioBinary], { type: input.mimeType }),
      input.fileName || 'audio.ogg',
    );

    const timeoutMs = this.configService.get<number>(
      'AI_TRANSCRIPTION_TIMEOUT_MS',
      30000,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        throw new Error(
          `OpenAI Whisper retornou status ${response.status}${details ? `: ${details}` : ''}`,
        );
      }

      const payload = (await response.json()) as {
        text?: string;
        language?: string;
      };

      if (!payload?.text || !payload.text.trim()) {
        throw new Error('OpenAI Whisper retornou transcrição vazia.');
      }

      return {
        text: payload.text,
        provider: this.name,
        latencyMs: Date.now() - startedAt,
        language: payload.language || input.language || null,
        confidence: null,
        durationSeconds: input.durationSeconds ?? null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
