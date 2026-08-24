import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
    return this.mutateLocked(userId, (atual) =>
      mergeOnboardingState(atual, dto),
    );
  }

  async reset(userId: string): Promise<OnboardingState> {
    const proximo = await this.mutateLocked(userId, () => ({
      ...emptyOnboardingState(),
      restartedAt: new Date().toISOString(),
    }));
    this.logger.log(`[ONBOARDING_RESET] user=${userId}`);
    return proximo;
  }

  /**
   * Serializa toda escrita do onboarding por usuário. Sem a transação + lock,
   * dois PATCHes que leem o mesmo JSONB antes de gravar fariam read/merge/write
   * concorrente, e a última escrita apagaria os passos adicionados pela outra.
   * O reset usa o mesmo caminho para ser ordenado com os PATCHes concorrentes.
   */
  private async mutateLocked(
    userId: string,
    mutate: (atual: OnboardingState) => OnboardingState,
  ): Promise<OnboardingState> {
    return this.userRepo.manager.transaction(async (manager) => {
      const user = await this.findLockedUserOrThrow(manager, userId);
      const proximo = mutate(normalizeOnboardingState(user.onboardingState));

      await manager.update(User, userId, { onboardingState: proximo });

      return proximo;
    });
  }

  private async findLockedUserOrThrow(
    manager: EntityManager,
    userId: string,
  ): Promise<User> {
    const user = await manager.findOne(User, {
      where: { id: userId },
      select: ['id', 'onboardingState'],
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
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
