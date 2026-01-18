import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { RecoveryCode } from '../entities/recovery-code.entity';

@Global()
@Injectable()
export class RecoveryCodeRepository {
  constructor(
    @InjectRepository(RecoveryCode)
    private readonly repository: Repository<RecoveryCode>,
  ) {}

  async create(data: Partial<RecoveryCode>): Promise<RecoveryCode> {
    const recoveryCode = this.repository.create(data);
    return await this.repository.save(recoveryCode);
  }

  async findOne(
    where: FindOptionsWhere<RecoveryCode>,
  ): Promise<RecoveryCode | null> {
    return await this.repository.findOne({ where });
  }

  async update(
    where: FindOptionsWhere<RecoveryCode>,
    data: Partial<RecoveryCode>,
  ): Promise<RecoveryCode> {
    await this.repository.update(where, data);
    return await this.repository.findOne({ where });
  }
}
