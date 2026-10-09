import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionQuotaPeriod } from '../entities/subscription-quota-period.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SubscriptionQuotaPeriodRepository extends BaseRepository<SubscriptionQuotaPeriod> {
  constructor(
    @InjectRepository(SubscriptionQuotaPeriod)
    repo: Repository<SubscriptionQuotaPeriod>,
  ) {
    super(repo);
  }

  async findCurrentForSubscription(
    subscriptionId: string,
    at: Date,
  ): Promise<SubscriptionQuotaPeriod | null> {
    return this.repository
      .createQueryBuilder('q')
      .where('q.subscriptionId = :subscriptionId', { subscriptionId })
      .andWhere('q.periodStart <= :at AND q.periodEnd > :at', { at })
      .getOne();
  }

  async tryConsume(periodId: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(SubscriptionQuotaPeriod)
      .set({
        surgeryRequestsUsed: () => '"surgery_requests_used" + 1',
      })
      .where('id = :periodId', { periodId })
      .andWhere(
        '("surgery_requests_limit" = -1 OR "surgery_requests_used" < "surgery_requests_limit")',
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
