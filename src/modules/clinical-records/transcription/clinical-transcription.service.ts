import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionService } from 'src/shared/ai/transcription/transcription.service';
import { validarTipoArquivo } from 'src/shared/storage/tipo-arquivo';

export const MAX_AUDIO_DITADO_BYTES = 15 * 1024 * 1024;

const AUDIO_PADRAO =
  'audio/ogg,audio/mpeg,audio/mp4,audio/webm,audio/wav,audio/x-wav';

@Injectable()
export class ClinicalTranscriptionService {
  private readonly logger = new Logger(ClinicalTranscriptionService.name);

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly configService: ConfigService,
  ) {}

  async transcribe(
    file: Express.Multer.File | undefined,
  ): Promise<{ text: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o áudio do ditado.');
    }
    if (file.size > this.maxBytes()) {
      throw new PayloadTooLargeException(
        'O áudio passou do tamanho máximo. Dite em trechos menores.',
      );
    }

    const { mime, ext } = await validarTipoArquivo(file, this.mimesAceitos());

    try {
      const resultado = await this.transcriptionService.transcribe({
        audioBuffer: file.buffer,
        mimeType: mime,
        fileName: `ditado.${ext ?? 'webm'}`,
        language: 'pt',
      });
      return { text: resultado.text };
    } catch (error) {
      this.logger.warn(
        `[DITADO] falha na transcrição bytes=${file.size} mime=${mime} motivo=${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível transcrever o áudio. Fale perto do microfone e tente de novo.',
      );
    }
  }

  private maxBytes(): number {
    const configurado = Number(
      this.configService.get<number>(
        'AI_AUDIO_MAX_BYTES',
        MAX_AUDIO_DITADO_BYTES,
      ),
    );
    return Number.isFinite(configurado) && configurado > 0
      ? Math.min(configurado, MAX_AUDIO_DITADO_BYTES)
      : MAX_AUDIO_DITADO_BYTES;
  }

  private mimesAceitos(): string[] {
    return this.configService
      .get<string>('AI_AUDIO_ALLOWED_MIME', AUDIO_PADRAO)
      .split(',')
      .map((mime) => mime.trim().toLowerCase())
      .filter(Boolean);
  }
}
