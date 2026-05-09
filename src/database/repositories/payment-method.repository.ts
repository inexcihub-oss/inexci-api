import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentMethod } from '../entities/payment-method.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class PaymentMethodRepository extends BaseRepository<PaymentMethod> {
  constructor(
    @InjectRepository(PaymentMethod) repo: Repository<PaymentMethod>,
  ) {
    super(repo);
  }

  async findByOwnerId(ownerId: string): Promise<PaymentMethod[]> {
    return this.repository.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  async findDefaultByOwnerId(ownerId: string): Promise<PaymentMethod | null> {
    return this.repository.findOne({
      where: { ownerId, isDefault: true },
    });
  }

  /** Marca todos como n\u00e3o-default; usado antes de marcar um novo como default. */
  async clearDefaultsForOwner(ownerId: string): Promise<void> {
    await this.repository.update({ ownerId }, { isDefault: false });
  }
}
