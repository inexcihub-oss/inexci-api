import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenaiWhisperProvider } from './providers/openai-whisper.provider';
import { FasterWhisperProvider } from './providers/faster-whisper.provider';
import {
  TranscriptionProviderName,
  TranscriptionRequest,
  TranscriptionResult,
} from './transcription.types';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly recentLatenciesMs: number[] = [];
  private successCount = 0;
  private failureCount = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly fasterWhisperProvider: FasterWhisperProvider,
    private readonly openaiWhisperProvider: OpenaiWhisperProvider,
  ) {}

  async transcribe(input: TranscriptionRequest): Promise<TranscriptionResult> {
    const primary = this.getPrimaryProviderName();
    const fallbackEnabled = this.isFallbackEnabled();

    try {
      const primaryResult = await this.executeProvider(primary, input);
      const normalized = this.normalizeResult(primaryResult);
      this.recordSuccess(normalized);
      return normalized;
    } catch (primaryError) {
      if (!fallbackEnabled) {
        this.recordFailure(primary, primaryError);
        throw primaryError;
      }

      const fallback =
        primary === 'faster_whisper' ? 'openai' : 'faster_whisper';
      this.logger.warn(
        `[AI_STT] fallback acionado primary=${primary} fallback=${fallback} reason=${this.errorMessage(primaryError)}`,
      );

      try {
        const fallbackResult = await this.executeProvider(fallback, input);
        const normalized = this.normalizeResult({
          ...fallbackResult,
          fallbackUsed: true,
        });
        this.recordSuccess(normalized);
        return normalized;
      } catch (fallbackError) {
        this.recordFailure(fallback, fallbackError);
        throw fallbackError;
      }
    }
  }

  private getPrimaryProviderName(): TranscriptionProviderName {
    const provider = this.configService
      .get<string>('AI_TRANSCRIPTION_PROVIDER', 'faster_whisper')
      .trim()
      .toLowerCase();

    if (provider === 'openai') return 'openai';
    return 'faster_whisper';
  }

  private isFallbackEnabled(): boolean {
    const raw = this.configService.get<string>(
      'AI_STT_ENABLE_FALLBACK',
      'false',
    );
    return raw.trim().toLowerCase() === 'true' || raw.trim() === '1';
  }

  private async executeProvider(
    provider: TranscriptionProviderName,
    input: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (provider === 'openai') {
      return this.openaiWhisperProvider.transcribe(input);
    }

    return this.fasterWhisperProvider.transcribe(input);
  }

  private normalizeResult(result: TranscriptionResult): TranscriptionResult {
    const text = (result.text || '')
      .replace(/\s+/g, ' ')
      .split('\0')
      .join('')
      .trim();

    return {
      ...result,
      text,
      language: result.language || 'pt-BR',
    };
  }

  private recordSuccess(result: TranscriptionResult): void {
    this.successCount += 1;
    this.recentLatenciesMs.push(result.latencyMs);

    if (this.recentLatenciesMs.length > 200) {
      this.recentLatenciesMs.splice(0, this.recentLatenciesMs.length - 200);
    }

    const p95 = this.calculateP95(this.recentLatenciesMs);

    this.logger.log(
      `[AI_STT_METRIC] status=success provider=${result.provider} fallback=${Boolean(result.fallbackUsed)} latencyMs=${result.latencyMs} p95_ms=${p95} success=${this.successCount} failure=${this.failureCount}`,
    );
  }

  private recordFailure(
    provider: TranscriptionProviderName,
    error: unknown,
  ): void {
    this.failureCount += 1;

    this.logger.error(
      `[AI_STT_METRIC] status=failure provider=${provider} success=${this.successCount} failure=${this.failureCount} error=${this.errorMessage(error)}`,
    );
  }

  private calculateP95(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.ceil(sorted.length * 0.95) - 1,
    );
    return sorted[index];
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
