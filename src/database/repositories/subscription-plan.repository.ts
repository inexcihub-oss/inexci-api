import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SubscriptionPlanRepository extends BaseRepository<SubscriptionPlan> {
  constructor(
    @InjectRepository(SubscriptionPlan) repo: Repository<SubscriptionPlan>,
  ) {
    super(repo);
  }

  /** Lista planos ativos (sem o trial default) ordenados por sort_order. */
  async findPublicPlans(): Promise<SubscriptionPlan[]> {
    return this.repository.find({
      where: { isActive: true, isTrialDefault: false },
      order: { sortOrder: 'ASC' },
    });
  }

  async findBySlug(slug: string): Promise<SubscriptionPlan | null> {
    return this.repository.findOne({ where: { slug } });
  }

  async findTrialDefault(): Promise<SubscriptionPlan | null> {
    return this.repository.findOne({
      where: { isActive: true, isTrialDefault: true },
    });
  }
}
