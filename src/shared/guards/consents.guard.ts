import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorator/is-public.decorator';
import {
  CURRENT_CONSENT_VERSIONS,
  REQUIRED_CONSENTS,
  isConsentVersionValid,
} from '../../config/consent.config';

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

    for (const type of REQUIRED_CONSENTS) {
      const currentVersion = CURRENT_CONSENT_VERSIONS[type];
      let acceptedVersion: string | null = null;

      switch (type) {
        case 'privacy_policy':
          acceptedVersion = user.privacy_policy_consent_version;
          break;
        case 'terms_of_use':
          acceptedVersion = user.terms_of_use_consent_version;
          break;
      }

      if (!isConsentVersionValid(acceptedVersion, currentVersion)) {
        missing.push(type);
      }
    }

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
