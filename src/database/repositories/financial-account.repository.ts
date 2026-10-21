import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { FinancialAccount } from '../entities/financial-account.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class FinancialAccountRepository extends BaseRepository<FinancialAccount> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(FinancialAccount));
  }

  findByOwner(
    ownerId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<FinancialAccount[]> {
    const where: FindOptionsWhere<FinancialAccount> = { ownerId };
    if (!options.includeInactive) where.active = true;
    return this.repository.find({
      where,
      order: { active: 'DESC', name: 'ASC' },
    });
  }

  findOwned(id: string, ownerId: string): Promise<FinancialAccount | null> {
    return this.repository.findOne({ where: { id, ownerId } });
  }

  save(account: FinancialAccount): Promise<FinancialAccount> {
    return this.repository.save(account);
  }
}
