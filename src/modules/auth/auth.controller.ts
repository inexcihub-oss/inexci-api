import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Put,
  Res,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import type { CookieOptions } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { CheckPhoneDto } from './dto/check-phone.dto';
import { AuthService } from './auth.service';
import { JsonOnlyGuard } from './json-only.guard';
import { TrustedOriginGuard } from './trusted-origin.guard';
import { Public } from 'src/shared/decorators/is-public.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';
import { ChangePasswordAuthenticatedDto } from './dto/change-password-authenticated.dto';
import { SendRecoveryDto } from './dto/send-recovery.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { MfaService } from './mfa/mfa.service';
import { DisableMfaDto, LoginMfaDto, MfaTotpCodeDto } from './mfa/dto/mfa.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

export const REFRESH_COOKIE_DEFAULT_PATH = '/auth';

export const REFRESH_COOKIE_LEGACY_PATHS = ['/', '/auth/refresh'];

@ApiTags('Autenticação')
@Controller('auth')
@SkipConsentCheck()
@UseGuards(JsonOnlyGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly REFRESH_COOKIE = 'refresh_token';
  private readonly REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
  ) {}

  private getRefreshCookieOptions(): CookieOptions {
    const configuredSameSite =
      process.env.AUTH_REFRESH_COOKIE_SAMESITE?.trim().toLowerCase();
    const sameSite: CookieOptions['sameSite'] =
      configuredSameSite === 'lax' ||
      configuredSameSite === 'strict' ||
      configuredSameSite === 'none'
        ? configuredSameSite
        : process.env.NODE_ENV === 'production'
          ? 'lax'
          : 'strict';

    const configuredPath = process.env.AUTH_REFRESH_COOKIE_PATH?.trim();
    const path = configuredPath || REFRESH_COOKIE_DEFAULT_PATH;

    const secureFromEnv = process.env.AUTH_REFRESH_COOKIE_SECURE?.trim();
    const secure =
      secureFromEnv === 'true'
        ? true
        : secureFromEnv === 'false'
          ? false
          : process.env.NODE_ENV === 'production' || sameSite === 'none';

    const domain = process.env.AUTH_REFRESH_COOKIE_DOMAIN?.trim();

    return {
      httpOnly: true,
      secure,
      sameSite,
      path,
      maxAge: this.REFRESH_COOKIE_MAX_AGE,
      ...(domain ? { domain } : {}),
    };
  }

  private setRefreshCookie(res: Response, token: string) {
    const options = this.getRefreshCookieOptions();
    this.clearRefreshCookieAt(
      res,
      REFRESH_COOKIE_LEGACY_PATHS.filter((path) => path !== options.path),
    );
    res.cookie(this.REFRESH_COOKIE, token, options);
  }

  private clearRefreshCookie(res: Response) {
    const { path } = this.getRefreshCookieOptions();
    this.clearRefreshCookieAt(res, [
      path ?? REFRESH_COOKIE_DEFAULT_PATH,
      REFRESH_COOKIE_DEFAULT_PATH,
      ...REFRESH_COOKIE_LEGACY_PATHS,
    ]);
  }

  private clearRefreshCookieAt(res: Response, paths: string[]) {
    const { maxAge: _maxAge, ...baseOptions } = this.getRefreshCookieOptions();

    const domainCandidates = baseOptions.domain
      ? [baseOptions.domain, undefined]
      : [undefined];

    for (const path of new Set(paths)) {
      for (const domain of domainCandidates) {
        const options: CookieOptions = { ...baseOptions, path };
        if (domain) {
          options.domain = domain;
        } else {
          delete options.domain;
        }
        res.clearCookie(this.REFRESH_COOKIE, options);
      }
    }
  }

  @Public()
  @Throttle({
    short: { ttl: 60000, limit: 3 },
    long: { ttl: 3600000, limit: 5 },
  })
  @Post('register')
  @ApiOperation({ summary: 'Registrar novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário registrado com sucesso' })
  async register(@Body() body: RegisterDto, @Req() req: Request) {
    return await this.authService.register(body, req.ip);
  }

  @Public()
  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 10 },
  })
  @Post('check-email')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Checa disponibilidade de e-mail no fluxo de cadastro',
  })
  @ApiResponse({
    status: 200,
    description: 'available | pending_invite | registered',
  })
  async checkEmail(@Body() req: CheckEmailDto) {
    return await this.authService.checkEmailAvailability(req.email);
  }

  @Public()
  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 10 },
  })
  @Post('check-phone')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Checa disponibilidade de telefone no fluxo de cadastro',
  })
  @ApiResponse({
    status: 200,
    description: 'available | registered',
  })
  async checkPhone(@Body() req: CheckPhoneDto) {
    return await this.authService.checkPhoneAvailability(req.phone);
  }

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('login')
  @ApiOperation({ summary: 'Login com email e senha' })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  async login(@Body() req: AuthDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(req);
    if (result && 'mfaRequired' in result) {
      return result;
    }
    if (result) {
      this.setRefreshCookie(res, result.refresh_token);
      const { refresh_token, ...body } = result;
      return body;
    }
    return null;
  }

  @Public()
  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  @Post('login/mfa')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Segunda etapa do login (código TOTP ou de recuperação)',
  })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Código inválido' })
  @ApiResponse({ status: 401, description: 'Etapa de verificação expirada' })
  @ApiResponse({ status: 429, description: 'Conta bloqueada por tentativas' })
  async loginMfa(
    @Body() body: LoginMfaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginWithMfa(body);
    this.setRefreshCookie(res, result.refresh_token);
    const { refresh_token, ...rest } = result;
    return rest;
  }

  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  @Post('mfa/setup')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Gera o segredo TOTP pendente de confirmação' })
  async mfaSetup(@CurrentUser() user: AuthenticatedUser) {
    return await this.mfaService.setup(user.userId);
  }

  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  @Post('mfa/enable')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ativa o MFA e devolve os códigos de recuperação (uma única vez)',
  })
  async mfaEnable(
    @Body() body: MfaTotpCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.mfaService.enable(user.userId, body.code);
  }

  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  @Post('mfa/disable')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Desativa o MFA (senha + código) e encerra as outras sessões',
  })
  async mfaDisable(
    @Body() body: DisableMfaDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.mfaService.disable(
      user.userId,
      body.password,
      body.code,
    );
    const tokens = await this.authService.issueSessionTokens(user.userId);
    this.setRefreshCookie(res, tokens.refresh_token);
    return { ...result, access_token: tokens.access_token };
  }

  @Throttle({
    short: { ttl: 60000, limit: 3 },
    long: { ttl: 3600000, limit: 10 },
  })
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Gera novos códigos de recuperação' })
  async mfaRecoveryCodes(
    @Body() body: MfaTotpCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.mfaService.regenerateRecoveryCodes(
      user.userId,
      body.code,
    );
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obter dados do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Dados do usuário' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return await this.authService.me(user.userId);
  }

  @Public()
  @Throttle({ long: { ttl: 3600000, limit: 3 } })
  @Post('sendRecoveryPasswordEmail')
  @ApiOperation({ summary: 'Enviar email de recuperação de senha' })
  @ApiResponse({ status: 200, description: 'Email enviado' })
  async sendRecoveryPasswordEmail(@Body() body: SendRecoveryDto) {
    return await this.authService.sendRecoveryPasswordEmail(body.email);
  }

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('validateRecoveryPasswordCode')
  @ApiOperation({ summary: 'Validar código de recuperação de senha' })
  @ApiResponse({ status: 200, description: 'Código válido' })
  async validateRecoveryPasswordCode(@Body() data: validationCodeDto) {
    return await this.authService.validateRecoveryPasswordCode(data);
  }

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('changePassword')
  @ApiOperation({ summary: 'Alterar senha (com código de recuperação)' })
  @ApiResponse({ status: 200, description: 'Senha alterada' })
  async changePassword(@Body() data: changePasswordDto) {
    return await this.authService.changePassword(data);
  }

  @Put('changePassword')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Alterar senha (autenticado)' })
  @ApiResponse({ status: 200, description: 'Senha alterada' })
  async changePasswordAuthenticated(
    @Body() data: ChangePasswordAuthenticatedDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePasswordAuthenticated(
      data,
      user.userId,
    );
    this.clearRefreshCookie(res);
    return result;
  }

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 60 } })
  @UseGuards(TrustedOriginGuard)
  @Post('refresh')
  @ApiOperation({ summary: 'Renovar access token via refresh token' })
  @ApiResponse({ status: 200, description: 'Token renovado' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      this.logger.debug(
        'Tentativa de refresh sem token (cookie/body ausentes). Se ocorrer para usuário logado, verifique SameSite/Domain/Path do cookie de refresh.',
      );
      throw new BadRequestException('Refresh token ausente');
    }
    try {
      const result = await this.authService.refreshAccessToken(refreshToken);
      this.setRefreshCookie(res, result.refresh_token);
      const { refresh_token, ...body } = result;
      return body;
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout e revogação de tokens' })
  @ApiResponse({ status: 200, description: 'Logout realizado' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.userId);
    this.clearRefreshCookie(res);
    return { message: 'Logout realizado com sucesso' };
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check da API' })
  @ApiResponse({ status: 200, description: 'API operacional' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @Post('verifyEmail')
  @ApiOperation({ summary: 'Confirmar e-mail via token' })
  @ApiResponse({ status: 200, description: 'E-mail confirmado' })
  async verifyEmail(@Body() body: VerifyEmailDto) {
    return await this.authService.verifyEmail(body.token);
  }

  @Throttle({ long: { ttl: 3600000, limit: 5 } })
  @Post('resendEmailVerification')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reenviar e-mail de confirmação' })
  @ApiResponse({ status: 200, description: 'E-mail reenviado' })
  async resendEmailVerification(@CurrentUser() user: AuthenticatedUser) {
    return await this.authService.resendEmailVerification(user.userId);
  }
}
