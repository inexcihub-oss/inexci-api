import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserRepository } from 'src/database/repositories/user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery_code.repository';
import { EmailService } from 'src/shared/email/email.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, RecoveryCode]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'fallback-secret-for-development',
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    UserRepository,
    AuthService,
    JwtStrategy,
    RecoveryCodeRepository,
    EmailService,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
