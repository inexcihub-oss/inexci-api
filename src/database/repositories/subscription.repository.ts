import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

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

  findWithGatewaySubscription(): Promise<Subscription[]> {
    return this.repository.find({
      where: {
        gatewaySubscriptionId: Not(IsNull()),
        status: Not(SubscriptionStatus.INTERNAL),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findPastDue(): Promise<Subscription[]> {
    return this.repository.find({
      where: { status: SubscriptionStatus.PAST_DUE },
    });
  }

  async updateUnlessInternal(
    id: string,
    data: QueryDeepPartialEntity<Subscription>,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Subscription)
      .set(data)
      .where('id = :id', { id })
      .andWhere('status <> :internal', {
        internal: SubscriptionStatus.INTERNAL,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  lockByOwnerId(
    ownerId: string,
    manager: EntityManager,
  ): Promise<Subscription | null> {
    return manager.getRepository(Subscription).findOne({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async updateWithManager(
    id: string,
    data: QueryDeepPartialEntity<Subscription>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(Subscription).update(id, data);
  }
}
