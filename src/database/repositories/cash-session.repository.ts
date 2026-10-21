import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { CashSession } from '../entities/cash-session.entity';
import { BaseRepository } from './base.repository';

export const FUSO_DOS_CAIXAS = 'America/Sao_Paulo';

export interface FiltrosDeCaixas {
  userId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class CashSessionRepository extends BaseRepository<CashSession> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(CashSession));
  }

  insert(
    dados: Partial<CashSession>,
    manager: EntityManager,
  ): Promise<CashSession> {
    const repo = manager.getRepository(CashSession);
    return repo.save(repo.create(dados));
  }

  save(sessao: CashSession, manager: EntityManager): Promise<CashSession> {
    return manager.getRepository(CashSession).save(sessao);
  }

  findOpenByUser(
    userId: string,
    ownerId: string,
    manager?: EntityManager,
  ): Promise<CashSession | null> {
    return this.repoFor(manager).findOne({
      where: { userId, ownerId, closedAt: IsNull() },
    });
  }

  async hasOpenForAccount(
    accountId: string,
    ownerId: string,
  ): Promise<boolean> {
    return this.repository.exists({
      where: { accountId, ownerId, closedAt: IsNull() },
    });
  }

  lockOpenByUser(
    userId: string,
    ownerId: string,
    manager: EntityManager,
  ): Promise<CashSession | null> {
    return manager.getRepository(CashSession).findOne({
      where: { userId, ownerId, closedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  lockOwned(
    id: string,
    ownerId: string,
    manager: EntityManager,
  ): Promise<CashSession | null> {
    return manager.getRepository(CashSession).findOne({
      where: { id, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findOwnedWithPeople(
    id: string,
    ownerId: string,
  ): Promise<CashSession | null> {
    return this.comPessoas()
      .where('s.id = :id', { id })
      .andWhere('s.ownerId = :ownerId', { ownerId })
      .getOne();
  }

  findPaged(
    ownerId: string,
    filtros: FiltrosDeCaixas,
    skip: number,
    take: number,
  ): Promise<[CashSession[], number]> {
    const qb = this.comPessoas().where('s.ownerId = :ownerId', { ownerId });
    if (filtros.userId) {
      qb.andWhere('s.userId = :userId', { userId: filtros.userId });
    }
    if (filtros.from) {
      qb.andWhere(
        `(s.opened_at AT TIME ZONE '${FUSO_DOS_CAIXAS}')::date >= :from`,
        { from: filtros.from },
      );
    }
    if (filtros.to) {
      qb.andWhere(
        `(s.opened_at AT TIME ZONE '${FUSO_DOS_CAIXAS}')::date <= :to`,
        { to: filtros.to },
      );
    }
    return qb
      .orderBy('s.openedAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  private comPessoas() {
    return this.repository
      .createQueryBuilder('s')
      .withDeleted()
      .leftJoin('s.user', 'user')
      .addSelect(['user.id', 'user.name'])
      .leftJoin('s.account', 'account')
      .addSelect(['account.id', 'account.name'])
      .leftJoin('s.closedBy', 'closedBy')
      .addSelect(['closedBy.id', 'closedBy.name']);
  }

  private repoFor(manager?: EntityManager): Repository<CashSession> {
    return manager ? manager.getRepository(CashSession) : this.repository;
  }
}
