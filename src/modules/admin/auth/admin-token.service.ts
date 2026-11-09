import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from 'src/modules/auth/jwt-payload.interface';

export const ADMIN_AUDIENCE_SUFFIX = ':admin';
export const ADMIN_ACCESS_TOKEN_TTL = '15m';
export const ADMIN_STEP_TOKEN_TTL = '5m';

export type AdminStepPurpose = 'mfa' | 'mfa_setup';

export const ADMIN_SESSAO_INVALIDA = 'Sessão do painel inválida ou expirada.';
export const ADMIN_ETAPA_EXPIRADA =
  'Sua verificação expirou. Entre com e-mail e senha novamente.';

export interface AdminAccessPayload {
  adminId: string;
  tv: number;
}

interface AdminTokenClaims {
  adminId?: unknown;
  tv?: unknown;
  purpose?: unknown;
}

@Injectable()
export class AdminTokenService {
  private readonly jwt: JwtService;
  private readonly issuer: string;
  private readonly baseAudience: string;

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    this.jwt = new JwtService({ secret });
    this.issuer = configService.get<string>('JWT_ISSUER', JWT_DEFAULT_ISSUER);
    this.baseAudience = `${configService.get<string>(
      'JWT_AUDIENCE',
      JWT_DEFAULT_AUDIENCE,
    )}${ADMIN_AUDIENCE_SUFFIX}`;
  }

  accessAudience(): string {
    return this.baseAudience;
  }

  stepAudience(purpose: AdminStepPurpose): string {
    return `${this.baseAudience}:${purpose}`;
  }

  signAccess(admin: { id: string; tokenVersion: number | null }): string {
    const payload: AdminAccessPayload = {
      adminId: admin.id,
      tv: admin.tokenVersion ?? 0,
    };
    return this.jwt.sign(payload, {
      issuer: this.issuer,
      audience: this.accessAudience(),
      expiresIn: ADMIN_ACCESS_TOKEN_TTL,
    });
  }

  verifyAccess(token: string): AdminAccessPayload {
    const claims = this.verificar(token, this.accessAudience(), () => {
      throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);
    });
    if (claims.purpose !== undefined) {
      throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);
    }
    return claims.payload;
  }

  signStep(
    purpose: AdminStepPurpose,
    admin: { id: string; tokenVersion: number | null },
  ): string {
    return this.jwt.sign(
      { adminId: admin.id, tv: admin.tokenVersion ?? 0, purpose },
      {
        issuer: this.issuer,
        audience: this.stepAudience(purpose),
        expiresIn: ADMIN_STEP_TOKEN_TTL,
      },
    );
  }

  verifyStep(purpose: AdminStepPurpose, token: string): AdminAccessPayload {
    const claims = this.verificar(token, this.stepAudience(purpose), () => {
      throw new UnauthorizedException(ADMIN_ETAPA_EXPIRADA);
    });
    if (claims.purpose !== purpose) {
      throw new UnauthorizedException(ADMIN_ETAPA_EXPIRADA);
    }
    return claims.payload;
  }

  private verificar(
    token: string,
    audience: string,
    recusar: () => never,
  ): { payload: AdminAccessPayload; purpose: unknown } {
    let claims: AdminTokenClaims;
    try {
      claims = this.jwt.verify<AdminTokenClaims & object>(token, {
        issuer: this.issuer,
        audience,
      });
    } catch {
      return recusar();
    }
    if (typeof claims?.adminId !== 'string' || !claims.adminId) {
      return recusar();
    }
    const tv = typeof claims.tv === 'number' ? claims.tv : 0;
    return {
      payload: { adminId: claims.adminId, tv },
      purpose: claims.purpose,
    };
  }
}
