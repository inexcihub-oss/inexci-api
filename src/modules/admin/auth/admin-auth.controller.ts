import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { JsonOnlyGuard } from 'src/modules/auth/json-only.guard';
import { refreshCookieFlags } from 'src/modules/auth/refresh-cookie.options';
import { TrustedOriginGuard } from 'src/modules/auth/trusted-origin.guard';
import { Public } from 'src/shared/decorators/is-public.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';
import { AdminAuthService, AdminSession } from './admin-auth.service';
import { AuthenticatedAdmin } from './admin-session.guard';
import {
  AdminAcceptInviteDto,
  AdminEnableMfaDto,
  AdminLoginDto,
  AdminLoginMfaDto,
  AdminLoginStepDto,
  AdminMfaSetupDto,
  AdminProfileDto,
  AdminRecoveryCodesDto,
  AdminRecoveryCodesResultDto,
  AdminSessionDto,
  AdminSessionWithRecoveryDto,
  AdminSetupTokenDto,
} from './dto/admin-auth.dto';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from './platform-admin-only.decorator';

export const ADMIN_REFRESH_COOKIE = 'inexci_admin_refresh';
export const ADMIN_REFRESH_COOKIE_PATH = '/admin/auth';
const ADMIN_REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const LIMITE_ETAPA = {
  short: { ttl: 60000, limit: 5 },
  long: { ttl: 3600000, limit: 20 },
};

export function adminRefreshCookieOptions(): CookieOptions {
  return {
    ...refreshCookieFlags(),
    path: ADMIN_REFRESH_COOKIE_PATH,
    maxAge: ADMIN_REFRESH_COOKIE_MAX_AGE,
  };
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [tipo, token] = header.trim().split(/\s+/);
  return tipo?.toLowerCase() === 'bearer' && token ? token : null;
}

function cookieDeRefresh(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const valor = cookies?.[ADMIN_REFRESH_COOKIE];
  return typeof valor === 'string' && valor ? valor : null;
}

@ApiTags('Admin - Autenticação')
@Controller('admin/auth')
@Public()
@SkipConsentCheck()
@UseGuards(JsonOnlyGuard)
export class AdminAuthController {
  constructor(private readonly service: AdminAuthService) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(ADMIN_REFRESH_COOKIE, token, adminRefreshCookieOptions());
  }

  private clearRefreshCookie(res: Response): void {
    const { maxAge: _maxAge, ...options } = adminRefreshCookieOptions();
    res.clearCookie(ADMIN_REFRESH_COOKIE, options);
  }

  private responder(res: Response, sessao: AdminSession): AdminSessionDto {
    this.setRefreshCookie(res, sessao.refreshToken);
    return { accessToken: sessao.accessToken, admin: sessao.admin };
  }

  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Primeira etapa do login do painel (e-mail e senha)',
  })
  @ApiOkResponse({ type: AdminLoginStepDto })
  login(@Body() body: AdminLoginDto) {
    return this.service.login(body.email, body.password);
  }

  @Throttle(LIMITE_ETAPA)
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera o segredo TOTP do primeiro acesso' })
  @ApiOkResponse({ type: AdminMfaSetupDto })
  mfaSetup(@Body() body: AdminSetupTokenDto) {
    return this.service.setupMfa(body.setupToken);
  }

  @Throttle(LIMITE_ETAPA)
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ativa o MFA, abre a sessão e devolve os códigos de recuperação (uma única vez)',
  })
  @ApiOkResponse({ type: AdminSessionWithRecoveryDto })
  async mfaEnable(
    @Body() body: AdminEnableMfaDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionWithRecoveryDto> {
    const result = await this.service.enableMfa(body.setupToken, body.code);
    return {
      ...this.responder(res, result),
      recoveryCodes: result.recoveryCodes,
    };
  }

  @Throttle(LIMITE_ETAPA)
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Segunda etapa do login (código TOTP ou de recuperação)',
  })
  @ApiOkResponse({ type: AdminSessionDto })
  async loginMfa(
    @Body() body: AdminLoginMfaDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto> {
    return this.responder(
      res,
      await this.service.loginWithMfa(body.mfaToken, body.code),
    );
  }

  @Throttle({ short: { ttl: 60000, limit: 60 } })
  @UseGuards(TrustedOriginGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova a sessão do painel pelo cookie' })
  @ApiOkResponse({ type: AdminSessionDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto> {
    const token = cookieDeRefresh(req);
    if (!token) throw new BadRequestException('Refresh token ausente');
    try {
      return this.responder(res, await this.service.refresh(token));
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        this.clearRefreshCookie(res);
      }
      throw error;
    }
  }

  @UseGuards(TrustedOriginGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerra a sessão do painel' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      await this.service.logout({
        accessToken: bearer(req),
        refreshToken: cookieDeRefresh(req),
      });
    } finally {
      this.clearRefreshCookie(res);
    }
  }

  @PlatformAdminOnly()
  @Get('me')
  @ApiOperation({ summary: 'Administrador da sessão atual' })
  @ApiOkResponse({ type: AdminProfileDto })
  me(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<AdminProfileDto> {
    return this.service.me(admin.adminId);
  }

  @PlatformAdminOnly()
  @Throttle({
    short: { ttl: 60000, limit: 3 },
    long: { ttl: 3600000, limit: 10 },
  })
  @Post('mfa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera novos códigos de recuperação' })
  @ApiOkResponse({ type: AdminRecoveryCodesResultDto })
  recoveryCodes(
    @Body() body: AdminRecoveryCodesDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminRecoveryCodesResultDto> {
    return this.service.regenerateRecoveryCodes(admin.adminId, body.code);
  }

  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 10 },
  })
  @Post('accept-invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Aceita o convite e define a senha' })
  @ApiNoContentResponse()
  async acceptInvite(@Body() body: AdminAcceptInviteDto): Promise<void> {
    await this.service.acceptInvite(body.email, body.token, body.password);
  }
}
