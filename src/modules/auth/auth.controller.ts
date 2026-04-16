import { Body, Controller, Get, Post, Put, Res, Req } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response, Request } from 'express';

import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthService } from './auth.service';
import { Public } from 'src/shared/decorator/is-public.decorator';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';
import { ChangePasswordAuthenticatedDto } from './dto/change-password-authenticated.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  /** Cookie httpOnly para refresh token */
  private readonly REFRESH_COOKIE = 'refresh_token';
  private readonly REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(this.REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge: this.REFRESH_COOKIE_MAX_AGE,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(this.REFRESH_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
    });
  }

  @Public()
  @Post('register')
  async register(
    @Body() req: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(req);
    this.setRefreshCookie(res, result.refresh_token);
    // Não enviar refresh_token no body — está no cookie httpOnly
    const { refresh_token, ...body } = result;
    return body;
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  async login(@Body() req: AuthDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(req);
    if (result) {
      this.setRefreshCookie(res, result.refresh_token);
      const { refresh_token, ...body } = result;
      return body;
    }
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return await this.authService.me(user.userId);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  @Post('sendRecoveryPasswordEmail')
  async sendRecoveryPasswordEmail(@Body('email') email: string) {
    return await this.authService.sendRecoveryPasswordEmail(email);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('validateRecoveryPasswordCode')
  async validateRecoveryPasswordCode(@Body() data: validationCodeDto) {
    return await this.authService.validateRecoveryPasswordCode(data);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('changePassword')
  async changePassword(@Body() data: changePasswordDto) {
    return await this.authService.changePassword(data);
  }

  @Put('changePassword')
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
  @Get('plans')
  async getPlans() {
    return await this.authService.getAvailablePlans();
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('refresh')
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
  async health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
