import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Refund } from '../entities/refund.entity';
import { PaymentMethod } from '../entities/payment-method-config.entity';
import { BaseRepository } from './base.repository';

export interface EstornadoPorForma {
  method: PaymentMethod;
  refunded: string;
}

@Injectable()
export class RefundRepository extends BaseRepository<Refund> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Refund));
  }

  insert(dados: Partial<Refund>, manager: EntityManager): Promise<Refund> {
    const repo = manager.getRepository(Refund);
    return repo.save(repo.create(dados));
  }

  async refundedByMethodForSession(
    cashSessionId: string,
  ): Promise<EstornadoPorForma[]> {
    const linhas = await this.repository
      .createQueryBuilder('r')
      .innerJoin('r.payment', 'p')
      .select('p.method', 'method')
      .addSelect('COALESCE(SUM(r.amount), 0)::numeric(12,2)', 'refunded')
      .where('r.cashSessionId = :cashSessionId', { cashSessionId })
      .groupBy('p.method')
      .getRawMany<{ method: PaymentMethod; refunded: string }>();
    return linhas.map((linha) => ({
      method: linha.method,
      refunded: linha.refunded,
    }));
  }
}
