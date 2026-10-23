import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionService } from 'src/shared/ai/transcription/transcription.service';
import { AI_CONSENT_REQUIRED_MESSAGE } from 'src/shared/guards/ai-consent.guard';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { validarTipoArquivo } from 'src/shared/storage/tipo-arquivo';

export const MAX_AUDIO_DITADO_BYTES = 15 * 1024 * 1024;

const AUDIO_PADRAO =
  'audio/ogg,audio/mpeg,audio/mp4,audio/webm,audio/wav,audio/x-wav';

export interface UsuarioDoDitado {
  userId: string;
  aiConsentAcceptedAt?: Date | string | null;
}

@Injectable()
export class ClinicalTranscriptionService {
  private readonly logger = new Logger(ClinicalTranscriptionService.name);

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly accessControlService: AccessControlService,
    private readonly configService: ConfigService,
  ) {}

  async transcribe(
    file: Express.Multer.File | undefined,
    user: UsuarioDoDitado,
  ): Promise<{ text: string }> {
    if (!this.ditadoHabilitado()) {
      throw new NotFoundException('Ditado por voz indisponível.');
    }
    await this.accessControlService.assertIsDoctor(user.userId);

    if (!this.audioHabilitado()) {
      throw new ServiceUnavailableException('Ditado por voz desativado.');
    }

    if (
      this.transcriptionService.usesExternalProvider() &&
      !user.aiConsentAcceptedAt
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'AI_CONSENT_REQUIRED',
        message: AI_CONSENT_REQUIRED_MESSAGE,
      });
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o áudio do ditado.');
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

  private ditadoHabilitado(): boolean {
    const raw = this.configService.get<string>(
      'CLINICAL_DICTATION_ENABLED',
      'false',
    );
    return ['true', '1'].includes(raw.trim().toLowerCase());
  }

  private audioHabilitado(): boolean {
    const raw = this.configService.get<string>('AI_AUDIO_ENABLED', 'true');
    return !['false', '0'].includes(raw.trim().toLowerCase());
  }

  private mimesAceitos(): string[] {
    return this.configService
      .get<string>('AI_AUDIO_ALLOWED_MIME', AUDIO_PADRAO)
      .split(',')
      .map((mime) => mime.trim().toLowerCase())
      .filter(Boolean);
  }
}
