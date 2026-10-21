import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  In,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Receivable, ReceivableStatus } from '../entities/receivable.entity';
import { BaseRepository } from './base.repository';

export interface FiltrosDeCobrancas {
  status?: ReceivableStatus;
  from?: string;
  to?: string;
  patientId?: string;
  executedById?: string;
}

export interface TotaisDaCobranca {
  totalAmount: string;
  paidAmount: string;
  status: ReceivableStatus;
}

export interface CobrancaAtivaDaConsulta {
  appointmentId: string;
  receivableId: string;
  status: ReceivableStatus;
}

const STATUS_EM_ABERTO = [ReceivableStatus.OPEN, ReceivableStatus.PARTIAL];

@Injectable()
export class ReceivableRepository extends BaseRepository<Receivable> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Receivable));
  }

  insert(
    dados: Partial<Receivable>,
    manager?: EntityManager,
  ): Promise<Receivable> {
    const repo = this.repoFor(manager);
    return repo.save(repo.create(dados));
  }

  findOwned(
    id: string,
    ownerId: string,
    manager?: EntityManager,
  ): Promise<Receivable | null> {
    return this.repoFor(manager).findOne({ where: { id, ownerId } });
  }

  lockOwned(
    id: string,
    ownerId: string,
    manager: EntityManager,
  ): Promise<Receivable | null> {
    return manager.getRepository(Receivable).findOne({
      where: { id, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async updateTotals(
    id: string,
    totais: TotaisDaCobranca,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(Receivable).update(id, {
      totalAmount: totais.totalAmount,
      paidAmount: totais.paidAmount,
      status: totais.status,
    });
  }

  async markCancelled(
    id: string,
    dados: { cancelledById: string; cancelReason: string; cancelledAt: Date },
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(Receivable).update(id, {
      status: ReceivableStatus.CANCELLED,
      cancelledAt: dados.cancelledAt,
      cancelledById: dados.cancelledById,
      cancelReason: dados.cancelReason,
    });
  }

  findDetail(id: string, ownerId: string): Promise<Receivable | null> {
    return this.repository
      .createQueryBuilder('r')
      .withDeleted()
      .leftJoin('r.patient', 'patient')
      .addSelect(['patient.id', 'patient.name'])
      .leftJoin('r.cancelledBy', 'cancelledBy')
      .addSelect(['cancelledBy.id', 'cancelledBy.name'])
      .leftJoin('r.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name'])
      .leftJoinAndSelect('r.items', 'item')
      .leftJoin('item.executedBy', 'executedBy')
      .addSelect(['executedBy.id', 'executedBy.name'])
      .leftJoinAndSelect('r.payments', 'payment')
      .leftJoin('payment.account', 'account')
      .addSelect(['account.id', 'account.name'])
      .leftJoin('payment.receivedBy', 'receivedBy')
      .addSelect(['receivedBy.id', 'receivedBy.name'])
      .leftJoinAndSelect('payment.refunds', 'refund')
      .leftJoin('refund.refundedBy', 'refundedBy')
      .addSelect(['refundedBy.id', 'refundedBy.name'])
      .where('r.id = :id', { id })
      .andWhere('r.ownerId = :ownerId', { ownerId })
      .orderBy('item.createdAt', 'ASC')
      .addOrderBy('payment.paidAt', 'ASC')
      .addOrderBy('payment.createdAt', 'ASC')
      .addOrderBy('refund.createdAt', 'ASC')
      .getOne();
  }

  findPaged(
    ownerId: string,
    filtros: FiltrosDeCobrancas,
    skip: number,
    take: number,
  ): Promise<[Receivable[], number]> {
    return this.filtrados(ownerId, filtros)
      .leftJoin('r.patient', 'patient')
      .addSelect(['patient.id', 'patient.name'])
      .orderBy('r.referenceDate', 'DESC')
      .addOrderBy('r.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  async sumOpenBalance(
    ownerId: string,
    filtros: FiltrosDeCobrancas,
  ): Promise<string> {
    const linha = await this.filtrados(ownerId, filtros)
      .select(
        'COALESCE(SUM(r.total_amount - r.paid_amount), 0)::numeric(12,2)',
        'saldo',
      )
      .andWhere('r.status IN (:...emAberto)', { emAberto: STATUS_EM_ABERTO })
      .getRawOne<{ saldo: string | null }>();
    return linha?.saldo ?? '0.00';
  }

  findByPatient(ownerId: string, patientId: string): Promise<Receivable[]> {
    return this.repository
      .createQueryBuilder('r')
      .withDeleted()
      .leftJoin('r.patient', 'patient')
      .addSelect(['patient.id', 'patient.name'])
      .where('r.ownerId = :ownerId', { ownerId })
      .andWhere('r.patientId = :patientId', { patientId })
      .orderBy('r.referenceDate', 'DESC')
      .addOrderBy('r.createdAt', 'DESC')
      .getMany();
  }

  async findActiveByAppointments(
    ownerId: string,
    appointmentIds: string[],
  ): Promise<CobrancaAtivaDaConsulta[]> {
    if (appointmentIds.length === 0) return [];
    const cobrancas = await this.repository.find({
      select: { id: true, appointmentId: true, status: true },
      where: {
        ownerId,
        appointmentId: In(appointmentIds),
        status: Not(ReceivableStatus.CANCELLED),
      },
    });
    return cobrancas
      .filter((cobranca) => cobranca.appointmentId !== null)
      .map((cobranca) => ({
        appointmentId: cobranca.appointmentId as string,
        receivableId: cobranca.id,
        status: cobranca.status,
      }));
  }

  private filtrados(
    ownerId: string,
    filtros: FiltrosDeCobrancas,
  ): SelectQueryBuilder<Receivable> {
    const qb = this.repository
      .createQueryBuilder('r')
      .withDeleted()
      .where('r.ownerId = :ownerId', { ownerId });
    if (filtros.status) {
      qb.andWhere('r.status = :status', { status: filtros.status });
    }
    if (filtros.from) {
      qb.andWhere('r.referenceDate >= :from', { from: filtros.from });
    }
    if (filtros.to) {
      qb.andWhere('r.referenceDate <= :to', { to: filtros.to });
    }
    if (filtros.patientId) {
      qb.andWhere('r.patientId = :patientId', {
        patientId: filtros.patientId,
      });
    }
    if (filtros.executedById) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM receivable_items ri WHERE ri.receivable_id = r.id AND ri.executed_by_id = :executedById AND ri.cancelled_at IS NULL)',
        { executedById: filtros.executedById },
      );
    }
    return qb;
  }

  private repoFor(manager?: EntityManager): Repository<Receivable> {
    return manager ? manager.getRepository(Receivable) : this.repository;
  }
}
