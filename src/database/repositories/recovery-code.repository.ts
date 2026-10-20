import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  IsNull,
} from 'typeorm';
import {
  RecoveryCode,
  RecoveryCodePurpose,
} from '../entities/recovery-code.entity';
import { BaseRepository } from './base.repository';

function linhasRetornadas(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

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

  findActive(
    userId: string,
    purpose: RecoveryCodePurpose,
  ): Promise<RecoveryCode | null> {
    return this.repository.findOne({
      where: { userId, purpose, used: false },
      order: { createdAt: 'DESC' },
    });
  }

  async consumeAttempt(
    id: string,
    maxAttempts: number,
  ): Promise<number | null> {
    const result = await this.repository
      .createQueryBuilder()
      .update(RecoveryCode)
      .set({
        attempts: () => '"attempts" + 1',
        used: () => `("attempts" + 1 >= :maxAttempts)`,
      })
      .where('"id" = :id', { id })
      .andWhere('"used" = false')
      .andWhere('"attempts" < :maxAttempts')
      .setParameters({ maxAttempts })
      .returning(['attempts'])
      .execute();

    const [linha] = linhasRetornadas(result.raw);
    if (!linha) return null;
    return Number(linha.attempts);
  }

  async issueResetToken(
    id: string,
    resetToken: string,
    resetTokenExpiresAt: Date,
  ): Promise<boolean> {
    const result = await this.repository.update(
      { id, resetToken: IsNull() },
      { used: true, resetToken, resetTokenExpiresAt },
    );
    return (result.affected ?? 0) > 0;
  }
}
