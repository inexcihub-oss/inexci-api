import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, QueryDeepPartialEntity } from 'typeorm';
import { RecoveryCode } from '../entities/recovery-code.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class RecoveryCodeRepository extends BaseRepository<RecoveryCode> {
  constructor(
    @InjectRepository(RecoveryCode)
    repository: Repository<RecoveryCode>,
  ) {
    super(repository);
  }

  async updateByWhere(
    where: FindOptionsWhere<RecoveryCode>,
    data: Partial<RecoveryCode>,
  ): Promise<RecoveryCode | null> {
    await this.repository.update(
      where,
      data as QueryDeepPartialEntity<RecoveryCode>,
    );
    return await this.repository.findOne({ where });
  }

  async deleteMany(where: FindOptionsWhere<RecoveryCode>): Promise<void> {
    await this.repository.delete(where);
  }
}
