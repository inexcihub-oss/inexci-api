import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
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
import { StorageModule } from 'src/shared/storage/storage.module';
import { StorageService } from 'src/shared/storage/storage.service';
import { RefreshTokenStore } from './refresh-token.store';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from './jwt-payload.interface';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, RecoveryCode]),
    PassportModule,
    MailModule,
    WhatsappModule,
    PrivacyModule,
    BillingModule,
    StorageModule,
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
        signOptions: {
          expiresIn: '15m',
          issuer: configService.get<string>('JWT_ISSUER', JWT_DEFAULT_ISSUER),
          audience: configService.get<string>(
            'JWT_AUDIENCE',
            JWT_DEFAULT_AUDIENCE,
          ),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, StorageService, RefreshTokenStore],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
