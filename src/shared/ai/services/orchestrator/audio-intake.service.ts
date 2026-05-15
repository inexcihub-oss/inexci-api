import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionService } from '../../transcription/transcription.service';
import { AudioPipelineService } from '../architecture/audio-pipeline.service';
import {
  InboundWhatsappMedia,
  WhatsappMediaService,
  WhatsappMediaValidationError,
} from '../../../whatsapp/whatsapp-media.service';

type AudioFailureReason =
  | 'AUDIO_NOT_ALLOWED'
  | 'AUDIO_TOO_LARGE'
  | 'AUDIO_TOO_LONG'
  | 'MEDIA_URL_INVALID'
  | 'STT_PROVIDER_UNREACHABLE'
  | 'STT_PROVIDER_ERROR'
  | 'STT_EMPTY_TRANSCRIPTION'
  | 'UNKNOWN';

export interface AudioProcessingResult {
  hasAudio: boolean;
  failed: boolean;
  failureReason?: AudioFailureReason;
  failureMessage?: string;
  transcription:
    | (Awaited<ReturnType<TranscriptionService['transcribe']>> & {
        downloadedMedia: { url: string; sizeBytes: number };
        fingerprint: string;
      })
    | null;
}

/**
 * Gerencia o pipeline de processamento de áudio inbound do WhatsApp:
 * download, transcrição e mapeamento de erros para mensagens amigáveis.
 *
 * Extraído de `AiOrchestratorService` na Fase 5 do
 * `PLANO-CORRECOES-CODE-REVIEW-2026-05-13.md`.
 */
@Injectable()
export class AudioIntakeService {
  private readonly logger = new Logger(AudioIntakeService.name);

  constructor(
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly transcriptionService: TranscriptionService,
    private readonly configService: ConfigService,
    @Optional() private readonly audioPipeline?: AudioPipelineService,
  ) {}

  isAudioEnabled(): boolean {
    const raw = this.configService.get<string>('AI_AUDIO_ENABLED', 'true');
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  async processInboundAudioIfNeeded(data: {
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'image' | 'pdf' | 'other';
      durationSeconds: number | null;
    }>;
    messageSid: string;
  }): Promise<AudioProcessingResult> {
    if (!this.isAudioEnabled()) {
      return { hasAudio: false, failed: false, transcription: null };
    }

    const mediaList = data.media || [];
    const audioMedia = mediaList.find((item) => {
      if (item.category === 'audio') return true;
      return this.whatsappMediaService.isAudioMime(item.contentType);
    });

    if (!audioMedia) {
      return { hasAudio: false, failed: false, transcription: null };
    }

    try {
      const downloaded = await this.whatsappMediaService.downloadInboundAudio(
        audioMedia as InboundWhatsappMedia,
      );
      const fingerprint = this.audioPipeline
        ? this.audioPipeline.buildFingerprint(downloaded.buffer)
        : 'legacy-audio';

      const cached = this.audioPipeline
        ? await this.audioPipeline.getCachedTranscription(fingerprint)
        : null;

      const transcription =
        cached ??
        (await this.transcriptionService.transcribe({
          audioBuffer: downloaded.buffer,
          mimeType: downloaded.mimeType,
          durationSeconds: downloaded.durationSeconds || null,
          fileName: downloaded.fileName,
          language: 'pt',
        }));

      if (!cached && this.audioPipeline) {
        await this.audioPipeline.setCachedTranscription(fingerprint, transcription);
      }

      this.logger.log(
        `[AI_STT] status=success sid=${data.messageSid} provider=${transcription.provider} bytes=${downloaded.sizeBytes} latencyMs=${transcription.latencyMs} fallback=${Boolean(transcription.fallbackUsed)} cache_hit=${Boolean(cached)}`,
      );

      return {
        hasAudio: true,
        failed: false,
        transcription: {
          ...transcription,
          downloadedMedia: {
            url: audioMedia.url,
            sizeBytes: downloaded.sizeBytes,
          },
          fingerprint,
        },
      };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);

      let reason: AudioFailureReason = 'UNKNOWN';

      if (error instanceof WhatsappMediaValidationError) {
        if (
          error.code === 'AUDIO_NOT_ALLOWED' ||
          error.code === 'AUDIO_TOO_LARGE' ||
          error.code === 'AUDIO_TOO_LONG' ||
          error.code === 'MEDIA_URL_INVALID'
        ) {
          reason = error.code;
        }
      } else if (/transcrição vazia/i.test(errMessage)) {
        reason = 'STT_EMPTY_TRANSCRIPTION';
      } else if (
        /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|aborted|ETIMEDOUT|UND_ERR_CONNECT/i.test(
          errMessage,
        )
      ) {
        reason = 'STT_PROVIDER_UNREACHABLE';
      } else if (
        /faster-whisper retornou status|openai-whisper retornou status|status 4\d\d|status 5\d\d/i.test(
          errMessage,
        )
      ) {
        reason = 'STT_PROVIDER_ERROR';
      }

      this.logger.warn(
        `[AI_STT] status=failure sid=${data.messageSid} reason=${reason} message=${errMessage}`,
      );

      return {
        hasAudio: true,
        failed: true,
        failureReason: reason,
        failureMessage: errMessage,
        transcription: null,
      };
    }
  }

  /**
   * Mapeia o motivo da falha do STT para uma resposta amigável e
   * acionável ao usuário, em vez do genérico "não consegui transcrever".
   */
  buildAudioFailureUserMessage(reason: string | undefined): string {
    switch (reason) {
      case 'AUDIO_NOT_ALLOWED':
        return 'O formato deste áudio não é suportado. Tente regravar o áudio diretamente pelo WhatsApp (que envia em formato compatível) ou digite a mensagem.';
      case 'AUDIO_TOO_LARGE':
        return 'Esse áudio é muito grande. Tente gravar um áudio mais curto (até ~5 minutos) ou digite a mensagem.';
      case 'AUDIO_TOO_LONG':
        return 'Esse áudio é muito longo. O limite é de 5 minutos. Pode quebrar em áudios menores ou digitar a mensagem.';
      case 'STT_PROVIDER_UNREACHABLE':
        return 'O serviço de transcrição está temporariamente indisponível. Pode digitar a mensagem que sigo daqui — assim que o serviço voltar, áudios funcionam de novo.';
      case 'STT_PROVIDER_ERROR':
        return 'O serviço de transcrição respondeu com um erro. Pode tentar novamente em alguns minutos ou, se preferir, digite a mensagem.';
      case 'STT_EMPTY_TRANSCRIPTION':
        return 'Recebi seu áudio mas não consegui identificar nenhum trecho de fala. Pode tentar gravar de novo (mais perto do microfone, sem ruído) ou digitar a mensagem?';
      case 'MEDIA_URL_INVALID':
        return 'Não consegui baixar o áudio enviado. Pode tentar de novo ou digitar a mensagem.';
      default:
        return 'Não consegui transcrever seu áudio desta vez. Pode tentar novamente enviando outro áudio mais curto ou, se preferir, digitar a mensagem.';
    }
  }

  buildUserInputForAi(input: {
    textInput: string;
    transcriptionText: string | null;
  }): string {
    const rawText = (input.textInput || '').trim();
    const transcriptionText = (input.transcriptionText || '').trim();

    if (rawText && transcriptionText) {
      return `${rawText}\n\nTranscrição do áudio: ${transcriptionText}`;
    }

    if (rawText) return rawText;
    if (transcriptionText) return transcriptionText;
    return '';
  }

  /**
   * Resolve a fonte da entrada do usuário com base na presença de texto
   * digitado e/ou transcrição de áudio.
   */
  resolveInboundSource(
    textInput: string,
    transcriptionContext: { text: string } | null,
  ): 'text' | 'audio' | 'text+audio' {
    const hasText = Boolean((textInput || '').trim());
    const hasAudio = Boolean(transcriptionContext?.text?.trim());

    if (hasText && hasAudio) return 'text+audio';
    if (hasAudio) return 'audio';
    return 'text';
  }
}
