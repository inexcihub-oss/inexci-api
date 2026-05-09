import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MailModule } from 'src/shared/mail/mail.module';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, RecoveryCode, RefreshToken]),
    PassportModule,
    MailModule,
    WhatsappModule,
    PrivacyModule,
    BillingModule,
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
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
