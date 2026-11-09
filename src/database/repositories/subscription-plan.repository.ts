import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SubscriptionPlanRepository extends BaseRepository<SubscriptionPlan> {
  constructor(
    @InjectRepository(SubscriptionPlan) repo: Repository<SubscriptionPlan>,
  ) {
    super(repo);
  }

  async findPublicPlans(): Promise<SubscriptionPlan[]> {
    return this.repository.find({
      where: { isActive: true },
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

  findByIds(ids: string[]): Promise<SubscriptionPlan[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { id: In(ids) } });
  }

  findWithGatewayPrice(): Promise<SubscriptionPlan[]> {
    return this.repository
      .createQueryBuilder('plan')
      .where('plan.gateway_price_id IS NOT NULL')
      .orderBy('plan.sort_order', 'ASC')
      .getMany();
  }
}
