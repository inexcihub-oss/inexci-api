import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../entities/payment-method-config.entity';
import { BaseRepository } from './base.repository';

export const FUSO_DOS_PAGAMENTOS = 'America/Sao_Paulo';

export interface FiltrosDePagamentos {
  from?: string;
  to?: string;
  method?: PaymentMethod;
  accountId?: string;
}

export interface TotaisDePagamentos {
  totalAmount: string;
  totalRefunded: string;
}

export interface RecebidoPorForma {
  method: PaymentMethod;
  received: string;
}

@Injectable()
export class PaymentRepository extends BaseRepository<Payment> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Payment));
  }

  insert(dados: Partial<Payment>, manager: EntityManager): Promise<Payment> {
    const repo = manager.getRepository(Payment);
    return repo.save(repo.create(dados));
  }

  findByIdempotencyKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<Payment | null> {
    return this.repository.findOne({ where: { ownerId, idempotencyKey } });
  }

  lockOwned(
    id: string,
    ownerId: string,
    manager: EntityManager,
  ): Promise<Payment | null> {
    return manager.getRepository(Payment).findOne({
      where: { id, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async addRefunded(
    id: string,
    valor: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(Payment)
      .createQueryBuilder()
      .update(Payment)
      .set({ refundedAmount: () => '"refunded_amount" + :valor' })
      .setParameter('valor', valor)
      .where('id = :id', { id })
      .execute();
  }

  async sumNetPaid(
    receivableId: string,
    manager: EntityManager,
  ): Promise<string> {
    const linha = await manager
      .getRepository(Payment)
      .createQueryBuilder('p')
      .select(
        'COALESCE(SUM(p.amount - p.refunded_amount), 0)::numeric(12,2)',
        'pago',
      )
      .where('p.receivableId = :receivableId', { receivableId })
      .getRawOne<{ pago: string | null }>();
    return linha?.pago ?? '0.00';
  }

  findPaged(
    ownerId: string,
    filtros: FiltrosDePagamentos,
    skip: number,
    take: number,
  ): Promise<[Payment[], number]> {
    return this.filtrados(ownerId, filtros)
      .innerJoin('p.receivable', 'receivable')
      .addSelect(['receivable.id', 'receivable.patientId'])
      .leftJoin('receivable.patient', 'patient')
      .addSelect(['patient.id', 'patient.name'])
      .leftJoin('p.account', 'account')
      .addSelect(['account.id', 'account.name'])
      .leftJoin('p.receivedBy', 'receivedBy')
      .addSelect(['receivedBy.id', 'receivedBy.name'])
      .orderBy('p.paidAt', 'DESC')
      .addOrderBy('p.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  async sumFiltered(
    ownerId: string,
    filtros: FiltrosDePagamentos,
  ): Promise<TotaisDePagamentos> {
    const linha = await this.filtrados(ownerId, filtros)
      .select('COALESCE(SUM(p.amount), 0)::numeric(12,2)', 'totalAmount')
      .addSelect(
        'COALESCE(SUM(p.refunded_amount), 0)::numeric(12,2)',
        'totalRefunded',
      )
      .getRawOne<{
        totalAmount: string | null;
        totalRefunded: string | null;
      }>();
    return {
      totalAmount: linha?.totalAmount ?? '0.00',
      totalRefunded: linha?.totalRefunded ?? '0.00',
    };
  }

  async receivedByMethodForSession(
    cashSessionId: string,
  ): Promise<RecebidoPorForma[]> {
    const linhas = await this.repository
      .createQueryBuilder('p')
      .select('p.method', 'method')
      .addSelect('COALESCE(SUM(p.amount), 0)::numeric(12,2)', 'received')
      .where('p.cashSessionId = :cashSessionId', { cashSessionId })
      .groupBy('p.method')
      .getRawMany<{ method: PaymentMethod; received: string }>();
    return linhas.map((linha) => ({
      method: linha.method,
      received: linha.received,
    }));
  }

  findOwnedWithDetails(id: string, ownerId: string): Promise<Payment | null> {
    return this.repository
      .createQueryBuilder('p')
      .withDeleted()
      .innerJoinAndSelect('p.receivable', 'receivable')
      .leftJoin('receivable.patient', 'patient')
      .addSelect(['patient.id', 'patient.name', 'patient.cpf'])
      .leftJoinAndSelect('receivable.items', 'item', 'item.cancelledAt IS NULL')
      .leftJoin('item.executedBy', 'executedBy')
      .addSelect(['executedBy.id', 'executedBy.name'])
      .leftJoin('p.account', 'account')
      .addSelect(['account.id', 'account.name'])
      .leftJoin('p.receivedBy', 'receivedBy')
      .addSelect(['receivedBy.id', 'receivedBy.name'])
      .leftJoinAndSelect('p.refunds', 'refund')
      .where('p.id = :id', { id })
      .andWhere('p.ownerId = :ownerId', { ownerId })
      .orderBy('item.createdAt', 'ASC')
      .addOrderBy('refund.createdAt', 'ASC')
      .getOne();
  }

  private filtrados(
    ownerId: string,
    filtros: FiltrosDePagamentos,
  ): SelectQueryBuilder<Payment> {
    const qb = this.repository
      .createQueryBuilder('p')
      .withDeleted()
      .where('p.ownerId = :ownerId', { ownerId });
    if (filtros.from) {
      qb.andWhere(
        `(p.paid_at AT TIME ZONE '${FUSO_DOS_PAGAMENTOS}')::date >= :from`,
        { from: filtros.from },
      );
    }
    if (filtros.to) {
      qb.andWhere(
        `(p.paid_at AT TIME ZONE '${FUSO_DOS_PAGAMENTOS}')::date <= :to`,
        { to: filtros.to },
      );
    }
    if (filtros.method) {
      qb.andWhere('p.method = :method', { method: filtros.method });
    }
    if (filtros.accountId) {
      qb.andWhere('p.accountId = :accountId', {
        accountId: filtros.accountId,
      });
    }
    return qb;
  }
}
