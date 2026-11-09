import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminActivationRepository } from 'src/database/repositories/admin-activation.repository';
import {
  ActivationCohortSummary,
  buildAccountActivation,
  summarizeCohort,
  summarizeOnboarding,
} from './activation-summary';
import { AdminAccountActivationDto } from './dto/admin-activation.dto';

@Injectable()
export class AdminActivationService {
  constructor(private readonly repository: AdminActivationRepository) {}

  async getAccountActivation(
    ownerId: string,
  ): Promise<AdminAccountActivationDto> {
    const [row, members] = await Promise.all([
      this.repository.findMilestones(ownerId),
      this.repository.findMembersOnboarding(ownerId),
    ]);
    if (!row) throw new NotFoundException('Conta não encontrada');
    return {
      ...buildAccountActivation(row),
      onboarding: summarizeOnboarding(members),
    };
  }

  async cohort(range: {
    from: Date;
    to: Date;
  }): Promise<ActivationCohortSummary> {
    return summarizeCohort(await this.repository.findCohortMilestones(range));
  }
}
