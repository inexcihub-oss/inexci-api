import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { resolveEffectivePermissions } from 'src/shared/permissions';
import {
  JwtPayload,
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from './jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly userRepository: UserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Verifica issuer/audience: rejeita tokens emitidos por outra origem.
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
    // findOneWithProfile (e não findOne) porque a permissão efetiva depende de
    // haver doctor_profile. É um LEFT JOIN na mesma consulta que já existia.
    const user = await this.userRepository.findOneWithProfile({
      id: payload.userId,
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Sessão inválida');
    }

    return {
      userId: payload.userId,
      ownerId: user.ownerId,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin ?? false,
      // Resolvido a cada request: mudança de permissão vale no request
      // seguinte, sem precisar de novo login.
      permissions: resolveEffectivePermissions({
        role: user.role,
        permissions: user.permissions,
        isDoctor: !!user.doctorProfile,
      }),
      privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt ?? null,
      termsOfUseAcceptedAt: user.termsOfUseAcceptedAt ?? null,
      aiConsentAcceptedAt: user.aiConsentAcceptedAt ?? null,
    };
  }
}
