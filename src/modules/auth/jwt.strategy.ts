import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRepository } from 'src/database/repositories/user.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly userRepository: UserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return secret;
      })(),
    });
  }

  async validate(payload: any) {
    const user = await this.userRepository.findOne({ id: payload.userId });
    return {
      userId: payload.userId,
      ownerId: user?.ownerId ?? null,
      role: user?.role,
      privacyPolicyAcceptedAt: user?.privacyPolicyAcceptedAt ?? null,
      termsOfUseAcceptedAt: user?.termsOfUseAcceptedAt ?? null,
      aiConsentAcceptedAt: user?.aiConsentAcceptedAt ?? null,
    };
  }
}
