import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { permissionsOf } from 'src/shared/permissions';
import {
  JwtPayload,
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
  tokenVersionValida,
} from './jwt-payload.interface';
import { CONTA_DESATIVADA_MENSAGEM } from './account-deactivation';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly userRepository: UserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: configService.get<string>('JWT_ISSUER', JWT_DEFAULT_ISSUER),
      audience: configService.get<string>('JWT_AUDIENCE', JWT_DEFAULT_AUDIENCE),
      secretOrKey: (() => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return secret;
      })(),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.purpose !== undefined) {
      throw new UnauthorizedException('Sessão inválida');
    }

    const session = await this.userRepository.findSessionUser(payload.userId);
    const user = session?.user;

    if (!session || !user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Sessão inválida');
    }

    if (!tokenVersionValida(payload, user.tokenVersion)) {
      throw new UnauthorizedException(
        'Sessão encerrada. Faça login novamente.',
      );
    }

    if (session.accountDeactivated) {
      throw new UnauthorizedException(CONTA_DESATIVADA_MENSAGEM);
    }

    return {
      userId: payload.userId,
      ownerId: user.ownerId,
      role: user.role,
      permissions: permissionsOf(user),
      privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt ?? null,
      termsOfUseAcceptedAt: user.termsOfUseAcceptedAt ?? null,
      aiConsentAcceptedAt: user.aiConsentAcceptedAt ?? null,
    };
  }
}
