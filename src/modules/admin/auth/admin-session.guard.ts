import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformAdminStatus } from 'src/database/entities/platform-admin.entity';
import { PlatformAdminRepository } from 'src/database/repositories/platform-admin.repository';
import { tokenVersionValida } from 'src/modules/auth/jwt-payload.interface';
import { errorMessage } from 'src/shared/utils/error-message.util';
import {
  ADMIN_SESSAO_INVALIDA,
  AdminTokenService,
} from './admin-token.service';

export interface AuthenticatedAdmin {
  adminId: string;
  name: string;
  email: string;
}

export type RequestComAdmin = Request & { admin?: AuthenticatedAdmin };

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [tipo, token] = header.trim().split(/\s+/);
  if (tipo?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  private readonly logger = new Logger(AdminSessionGuard.name);

  constructor(
    private readonly tokens: AdminTokenService,
    private readonly admins: PlatformAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestComAdmin>();
    const token = bearer(req);
    if (!token) throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);

    const payload = this.tokens.verifyAccess(token);
    const admin = await this.admins.findSession(payload.adminId);
    if (
      !admin ||
      admin.status !== PlatformAdminStatus.ACTIVE ||
      !admin.mfaEnabledAt ||
      !tokenVersionValida(payload, admin.tokenVersion)
    ) {
      throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);
    }

    req.admin = { adminId: admin.id, name: admin.name, email: admin.email };
    this.admins.touchLastSeen(admin.id).catch((err: unknown) => {
      this.logger.warn(
        `Falha ao gravar último acesso do administrador ${admin.id}: ${errorMessage(err)}`,
      );
    });
    return true;
  }
}
