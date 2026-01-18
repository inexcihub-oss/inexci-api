import { Body, Controller, Get, Post, Request } from '@nestjs/common';

import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthService } from './auth.service';
import { Public } from 'src/shared/decorator/is-public.decorator';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() req: RegisterDto) {
    return await this.authService.register(req);
  }

  @Public()
  @Post('login')
  async login(@Body() req: AuthDto) {
    return await this.authService.login(req);
  }

  @Get('me')
  async me(@Request() req: any) {
    return await this.authService.me(req.user.userId);
  }

  @Public()
  @Post('sendRecoveryPasswordEmail')
  async sendRecoveryPasswordEmail(@Body('email') email: string) {
    return await this.authService.sendRecoveryPasswordEmail(email);
  }

  @Public()
  @Post('validateRecoveryPasswordCode')
  async validateRecoveryPasswordCode(@Body() data: validationCodeDto) {
    return await this.authService.validateRecoveryPasswordCode(data);
  }

  @Public()
  @Post('changePassword')
  async changePassword(@Body() data: changePasswordDto) {    
    return await this.authService.changePassword(data);
  }

  @Public()
  @Get('health')
  async health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
