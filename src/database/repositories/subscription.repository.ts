import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SubscriptionRepository extends BaseRepository<Subscription> {
  constructor(@InjectRepository(Subscription) repo: Repository<Subscription>) {
    super(repo);
  }

  async findByOwnerId(ownerId: string): Promise<Subscription | null> {
    return this.repository.findOne({
      where: { ownerId },
      relations: ['plan', 'nextPlan'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByGatewaySubscriptionId(
    gatewaySubscriptionId: string,
  ): Promise<Subscription | null> {
    return this.repository.findOne({
      where: { gatewaySubscriptionId },
      relations: ['plan'],
    });
  }

  async findByGatewayCustomerId(
    gatewayCustomerId: string,
  ): Promise<Subscription | null> {
    return this.repository.findOne({
      where: { gatewayCustomerId },
      relations: ['plan'],
    });
  }

  /** Subscriptions cujo trial expira at\u00e9 a data informada. */
  async findExpiringTrialsBefore(date: Date): Promise<Subscription[]> {
    return this.repository.find({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: LessThan(date),
      },
      relations: ['plan'],
    });
  }

  /** Subscriptions em PAST_DUE h\u00e1 mais tempo que `cutoff`. */
  async findPastDueOlderThan(cutoff: Date): Promise<Subscription[]> {
    return this.repository.find({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        pastDueSince: LessThan(cutoff),
      },
      relations: ['plan'],
    });
  }

  /** Subscriptions com cancelamento agendado e per\u00edodo expirado. */
  async findCancelAtPeriodEndDue(now: Date): Promise<Subscription[]> {
    return this.repository.find({
      where: {
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]),
        cancelAtPeriodEnd: true,
        currentPeriodEnd: LessThan(now),
      },
      relations: ['plan'],
    });
  }

  /** Subscriptions ativas cujo per\u00edodo de cota expirou (renova\u00e7\u00e3o de cota). */
  async findActiveWithExpiredPeriod(now: Date): Promise<Subscription[]> {
    return this.repository.find({
      where: [
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: LessThan(now),
        },
        {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: LessThan(now),
        },
      ],
      relations: ['plan'],
    });
  }
}
