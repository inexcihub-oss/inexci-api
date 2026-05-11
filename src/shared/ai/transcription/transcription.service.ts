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
    const text = this.postProcessSpokenText(
      (result.text || '').replace(/\s+/g, ' ').split('\0').join('').trim(),
    );

    return {
      ...result,
      text,
      language: result.language || 'pt-BR',
    };
  }

  /**
   * Pós-processa a transcrição do Whisper para reduzir erros recorrentes em
   * mensagens ditadas em português brasileiro:
   *
   *  - "arroba" → "@"             (e-mails ditados oralmente)
   *  - "ponto com/br/etc."        → ".com"/".br"/etc.
   *  - "traço/hífen"              → "-"
   *  - "espaço" entre dígitos     → junção dos dígitos quando formam DDD+telefone
   *
   * Sem isso, e-mail "joao arroba teste ponto com" e telefone "31 99999 9999"
   * chegam ao pipeline como literais que o regex de PII não reconhece e a IA
   * trata como nome/texto comum.
   */
  private postProcessSpokenText(input: string): string {
    if (!input) return input;
    let out = input;

    // E-mails: "arroba" → "@" e "ponto X" → ".X" (com tld curto)
    out = out.replace(/\s+arroba\s+/gi, '@');
    out = out.replace(/\barroba\b/gi, '@');
    out = out.replace(/\s+ponto\s+(com|br|net|org|edu|gov|io|app)\b/gi, '.$1');
    // Limpa espaços residuais ao redor de @ e .
    out = out.replace(/\s*@\s*/g, '@');
    out = out.replace(/(@[^\s]+)\s+\.\s*/g, '$1.');

    // Telefones falados: "31 99999 9999" / "31 9 9999 9999" / "(31) 9 9999-9999"
    // Junta sequências de dígitos separadas por espaços/pontos/hífens quando
    // totalizam um número de telefone (10 a 13 dígitos no agregado). Exige
    // pelo menos 2 grupos para não grudar números soltos do contexto.
    out = out.replace(
      /(?:\+?\s*55[\s.-]*)?\(?\d{2,4}\)?(?:[\s.-]+\d+){1,5}/g,
      (match) => {
        const digits = match.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 13) return match;
        return digits;
      },
    );

    // "traço"/"hifen" entre números → "-"
    out = out.replace(/(\d)\s+(?:tra[çc]o|h[ií]fen)\s+(\d)/gi, '$1-$2');

    return out.replace(/\s{2,}/g, ' ').trim();
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
