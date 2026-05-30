import { Body, Controller, Get, Post, Put, Res, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthService } from './auth.service';
import { Public } from 'src/shared/decorator/is-public.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';
import { ChangePasswordAuthenticatedDto } from './dto/change-password-authenticated.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Autenticação')
@Controller('auth')
@SkipConsentCheck()
export class AuthController {
  /** Cookie httpOnly para refresh token */
  private readonly REFRESH_COOKIE = 'refresh_token';
  private readonly REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(this.REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: this.REFRESH_COOKIE_MAX_AGE,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(this.REFRESH_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
    });
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Registrar novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário registrado com sucesso' })
  async register(@Body() req: RegisterDto) {
    const result = await this.authService.register(req);
    // Não inicia sessão — o usuário precisa confirmar o e-mail antes de logar.
    const { refresh_token: _rt, access_token: _at, ...body } = result;
    return body;
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  @ApiOperation({ summary: 'Login com email e senha' })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  async login(@Body() req: AuthDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(req);
    if (result) {
      this.setRefreshCookie(res, result.refresh_token);
      const { refresh_token, ...body } = result;
      return body;
    }
    return null;
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obter dados do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Dados do usuário' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return await this.authService.me(user.userId);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  @Post('sendRecoveryPasswordEmail')
  @ApiOperation({ summary: 'Enviar email de recuperação de senha' })
  @ApiResponse({ status: 200, description: 'Email enviado' })
  async sendRecoveryPasswordEmail(@Body('email') email: string) {
    return await this.authService.sendRecoveryPasswordEmail(email);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('validateRecoveryPasswordCode')
  @ApiOperation({ summary: 'Validar código de recuperação de senha' })
  @ApiResponse({ status: 200, description: 'Código válido' })
  async validateRecoveryPasswordCode(@Body() data: validationCodeDto) {
    return await this.authService.validateRecoveryPasswordCode(data);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
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
    // Revogar todos os refresh tokens ao trocar senha
    await this.authService.revokeRefreshTokens(user.userId);
    this.clearRefreshCookie(res);
    return result;
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Renovar access token via refresh token' })
  @ApiResponse({ status: 200, description: 'Token renovado' })
  async refresh(
    @Req() req: Request,
    @Body('refresh_token') bodyToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Prioriza cookie httpOnly; fallback para body (retrocompatibilidade temporária)
    const refreshToken = req.cookies?.refresh_token || bodyToken;
    const result = await this.authService.refreshAccessToken(refreshToken);
    this.setRefreshCookie(res, result.refresh_token);
    const { refresh_token, ...body } = result;
    return body;
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout e revogação de tokens' })
  @ApiResponse({ status: 200, description: 'Logout realizado' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.revokeRefreshTokens(user.userId);
    this.clearRefreshCookie(res);
    return { message: 'Logout realizado com sucesso' };
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check da API' })
  @ApiResponse({ status: 200, description: 'API operacional' })
  async health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('verifyEmail')
  @ApiOperation({ summary: 'Confirmar e-mail via token' })
  @ApiResponse({ status: 200, description: 'E-mail confirmado' })
  async verifyEmail(@Body('token') token: string) {
    return await this.authService.verifyEmail(token);
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('resendEmailVerification')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reenviar e-mail de confirmação' })
  @ApiResponse({ status: 200, description: 'E-mail reenviado' })
  async resendEmailVerification(@CurrentUser() user: AuthenticatedUser) {
    return await this.authService.resendEmailVerification(user.userId);
  }
}
