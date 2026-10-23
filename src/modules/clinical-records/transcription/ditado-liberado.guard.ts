import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionService } from 'src/shared/ai/transcription/transcription.service';
import { exigirConsentimentoDeIa } from 'src/shared/guards/ai-consent.guard';
import { AccessControlService } from 'src/shared/services/access-control.service';

export interface UsuarioDoDitado {
  userId: string;
  aiConsentAcceptedAt?: Date | string | null;
}

@Injectable()
export class DitadoLiberadoGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly accessControlService: AccessControlService,
    private readonly transcriptionService: TranscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      !['true', '1'].includes(this.valor('CLINICAL_DICTATION_ENABLED', 'false'))
    ) {
      throw new NotFoundException('Ditado por voz indisponível.');
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: UsuarioDoDitado }>();
    if (!user?.userId) {
      throw new ForbiddenException(
        'Apenas médicos podem realizar esta operação.',
      );
    }
    await this.accessControlService.assertIsDoctor(user.userId);

    if (['false', '0'].includes(this.valor('AI_AUDIO_ENABLED', 'true'))) {
      throw new ServiceUnavailableException('Ditado por voz desativado.');
    }

    if (this.transcriptionService.usesExternalProvider()) {
      exigirConsentimentoDeIa(user);
    }

    return true;
  }

  private valor(chave: string, padrao: string): string {
    return (this.configService.get<string>(chave, padrao) ?? padrao)
      .trim()
      .toLowerCase();
  }
}
