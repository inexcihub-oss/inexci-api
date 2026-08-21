import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { RequirePermission } from '../../shared/decorators/require-permission.decorator';
import { UpdateOnboardingStateDto } from './dto/update-onboarding-state.dto';
import { OnboardingService } from './onboarding.service';

/**
 * `@RequirePermission()` sem argumentos é o opt-out explícito documentado no
 * CLAUDE.md: rota liberada para qualquer autenticado.
 *
 * Não é descuido. Um colaborador recém-criado com `permissions: []` precisa
 * ler o próprio estado e ver o modal de boas-vindas; exigir uma área aqui o
 * deixaria com a tela travada justamente no primeiro acesso.
 */
@ApiTags('Onboarding')
@ApiBearerAuth()
@Controller('onboarding')
@RequirePermission()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('state')
  @SkipThrottle()
  @ApiOperation({ summary: 'Progresso do onboarding do usuário autenticado.' })
  async getState(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.get(user.userId);
  }

  @Patch('state')
  @SkipThrottle()
  @ApiOperation({ summary: 'Atualiza parcialmente o progresso do onboarding.' })
  async patchState(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOnboardingStateDto,
  ) {
    return this.onboardingService.patch(user.userId, dto);
  }

  @Post('reset')
  @ApiOperation({ summary: 'Reinicia o onboarding (botão "Refazer").' })
  async reset(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.reset(user.userId);
  }
}
