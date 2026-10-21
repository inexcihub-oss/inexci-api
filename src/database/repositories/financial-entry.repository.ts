import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { FinancialEntry } from '../entities/financial-entry.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class FinancialEntryRepository extends BaseRepository<FinancialEntry> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(FinancialEntry));
  }

  insert(
    dados: Partial<FinancialEntry>,
    manager: EntityManager,
  ): Promise<FinancialEntry> {
    const repo = manager.getRepository(FinancialEntry);
    return repo.save(repo.create(dados));
  }

  async linkCounterpart(
    id: string,
    counterpartEntryId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(FinancialEntry)
      .update(id, { counterpartEntryId });
  }

  async cashSessionBalance(
    cashSessionId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const linha = await this.repoFor(manager)
      .createQueryBuilder('e')
      .select(
        "COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END), 0)::numeric(12,2)",
        'saldo',
      )
      .where('e.cashSessionId = :cashSessionId', { cashSessionId })
      .getRawOne<{ saldo: string | null }>();
    return linha?.saldo ?? '0.00';
  }

  findByCashSession(cashSessionId: string): Promise<FinancialEntry[]> {
    return this.repository.find({
      where: { cashSessionId },
      order: { occurredAt: 'ASC', createdAt: 'ASC' },
    });
  }

  private repoFor(manager?: EntityManager): Repository<FinancialEntry> {
    return manager ? manager.getRepository(FinancialEntry) : this.repository;
  }
}
