import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
      relations: ['plan'],
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

  async findPastDue(): Promise<Subscription[]> {
    return this.repository.find({
      where: { status: SubscriptionStatus.PAST_DUE },
    });
  }
}
