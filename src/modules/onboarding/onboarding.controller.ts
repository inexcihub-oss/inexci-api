import { Body, Controller, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { RequirePermission } from '../../shared/decorators/require-permission.decorator';
import { UpdateOnboardingStateDto } from './dto/update-onboarding-state.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('Onboarding')
@ApiBearerAuth()
@Controller('onboarding')
@RequirePermission()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

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
