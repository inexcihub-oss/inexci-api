import { Global, Module } from '@nestjs/common';
import { AuthModule } from 'src/modules/auth/auth.module';
import { JsonOnlyGuard } from 'src/modules/auth/json-only.guard';
import { TrustedOriginGuard } from 'src/modules/auth/trusted-origin.guard';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminRefreshTokenStore } from './admin-refresh-token.store';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminTokenService } from './admin-token.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController],
  providers: [
    AdminTokenService,
    AdminRefreshTokenStore,
    AdminAuthService,
    AdminSessionGuard,
    JsonOnlyGuard,
    TrustedOriginGuard,
  ],
  exports: [
    AdminTokenService,
    AdminRefreshTokenStore,
    AdminAuthService,
    AdminSessionGuard,
  ],
})
export class AdminAuthModule {}
