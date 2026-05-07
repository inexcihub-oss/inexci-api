import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsentLog, ConsentType } from '../entities/consent-log.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ConsentLogRepository extends BaseRepository<ConsentLog> {
  constructor(
    @InjectRepository(ConsentLog)
    repository: Repository<ConsentLog>,
  ) {
    super(repository);
  }

  /** Histórico mais recente primeiro, opcionalmente filtrado por tipo. */
  findHistory(
    user_id: string,
    type?: ConsentType,
    limit = 50,
  ): Promise<ConsentLog[]> {
    return this.repository.find({
      where: type ? { user_id, consent_type: type } : { user_id },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }
}
