import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
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

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async get(userId: string): Promise<OnboardingState> {
    const user = await this.findUserOrThrow(userId);
    return normalizeOnboardingState(user.onboardingState);
  }

  async patch(
    userId: string,
    dto: UpdateOnboardingStateDto,
  ): Promise<OnboardingState> {
    const atual = await this.get(userId);
    const proximo = mergeOnboardingState(atual, dto);
    await this.userRepo.update(userId, { onboardingState: proximo });
    return proximo;
  }

  async reset(userId: string): Promise<OnboardingState> {
    await this.findUserOrThrow(userId);
    const proximo: OnboardingState = {
      ...emptyOnboardingState(),
      restartedAt: new Date().toISOString(),
    };
    await this.userRepo.update(userId, { onboardingState: proximo });
    this.logger.log(`[ONBOARDING_RESET] user=${userId}`);
    return proximo;
  }

  private async findUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'onboardingState'],
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }
}
