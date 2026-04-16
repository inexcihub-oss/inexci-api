import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { EmailService } from 'src/shared/email/email.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, RecoveryCode, RefreshToken, SubscriptionPlan]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: (() => {
          const secret = configService.get<string>('JWT_SECRET');
          if (!secret) {
            throw new Error('JWT_SECRET environment variable is required');
          }
          return secret;
        })(),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    EmailService,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
