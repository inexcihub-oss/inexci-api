import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  isAllowedOrigin,
  parseAllowedOrigins,
} from 'src/shared/bootstrap/allowed-origins';

export const ORIGEM_NAO_PERMITIDA_MENSAGEM =
  'Origem da requisição não permitida.';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  private readonly logger = new Logger(TrustedOriginGuard.name);
  private readonly allowedOrigins: string[];

  constructor(configService: ConfigService) {
    this.allowedOrigins = parseAllowedOrigins(
      configService.get<string>('CORS_ORIGINS'),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;

    if (origin) {
      if (isAllowedOrigin(origin, this.allowedOrigins)) return true;
      return this.recusar(`origin=${origin.slice(0, 200)}`);
    }

    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site') {
      return this.recusar('sec-fetch-site=cross-site');
    }

    return true;
  }

  private recusar(motivo: string): never {
    this.logger.warn(`[AUTH_ORIGIN_BLOCKED] ${motivo}`);
    throw new ForbiddenException(ORIGEM_NAO_PERMITIDA_MENSAGEM);
  }
}
