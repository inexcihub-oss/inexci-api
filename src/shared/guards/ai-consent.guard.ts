import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

export const AI_CONSENT_REQUIRED_MESSAGE =
  'Esta função usa inteligência artificial. Autorize o uso de IA em Configurações > Privacidade para continuar.';

@Injectable()
export class AiConsentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{
      user?: { aiConsentAcceptedAt?: Date | string | null };
    }>();

    if (!user?.aiConsentAcceptedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'AI_CONSENT_REQUIRED',
        message: AI_CONSENT_REQUIRED_MESSAGE,
      });
    }

    return true;
  }
}
