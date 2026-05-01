import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { EmailVerification } from '../entities/email-verification.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class EmailVerificationRepository extends BaseRepository<EmailVerification> {
  constructor(
    @InjectRepository(EmailVerification)
    repository: Repository<EmailVerification>,
  ) {
    super(repository);
  }

  async updateByWhere(
    where: FindOptionsWhere<EmailVerification>,
    data: Partial<EmailVerification>,
  ): Promise<EmailVerification> {
    await this.repository.update(where, data);
    return await this.repository.findOne({ where });
  }

  async deleteMany(where: FindOptionsWhere<EmailVerification>): Promise<void> {
    await this.repository.delete(where);
  }
}
