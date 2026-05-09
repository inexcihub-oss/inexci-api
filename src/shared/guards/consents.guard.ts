import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorator/is-public.decorator';

export const SKIP_CONSENT_CHECK_KEY = 'skipConsentCheck';

@Injectable()
export class ConsentsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_CONSENT_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return true;

    const missing: string[] = [];
    if (!user.privacyPolicyAcceptedAt) missing.push('privacy_policy');
    if (!user.termsOfUseAcceptedAt) missing.push('terms_of_use');

    if (missing.length > 0) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'CONSENT_REQUIRED',
        message:
          'Consentimentos obrigatórios pendentes. Acesse a plataforma web para aceitar.',
        pending_consents: missing,
      });
    }

    return true;
  }
}
