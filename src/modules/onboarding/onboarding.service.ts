import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../database/repositories/user.repository';
import { UpdateOnboardingStateDto } from './dto/update-onboarding-state.dto';
import { emptyOnboardingState } from './onboarding.constants';
import {
  mergeOnboardingState,
  normalizeOnboardingState,
} from './onboarding.merge';
import { OnboardingState } from './onboarding.types';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly userRepository: UserRepository) {}

  async patch(
    userId: string,
    dto: UpdateOnboardingStateDto,
  ): Promise<OnboardingState> {
    return this.mutate(userId, (atual) => mergeOnboardingState(atual, dto));
  }

  async reset(userId: string): Promise<OnboardingState> {
    const proximo = await this.mutate(userId, () => ({
      ...emptyOnboardingState(),
      restartedAt: new Date().toISOString(),
    }));
    this.logger.log(`[ONBOARDING_RESET] user=${userId}`);
    return proximo;
  }

  private async mutate(
    userId: string,
    mutate: (atual: OnboardingState) => OnboardingState,
  ): Promise<OnboardingState> {
    const proximo = await this.userRepository.mutateOnboardingStateLocked(
      userId,
      (atual) => mutate(normalizeOnboardingState(atual)),
    );
    if (!proximo) throw new NotFoundException('Usuário não encontrado');
    return proximo;
  }
}
