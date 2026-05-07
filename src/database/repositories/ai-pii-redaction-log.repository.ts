import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiPiiRedactionLog } from '../entities/ai-pii-redaction-log.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AiPiiRedactionLogRepository extends BaseRepository<AiPiiRedactionLog> {
  constructor(
    @InjectRepository(AiPiiRedactionLog)
    repository: Repository<AiPiiRedactionLog>,
  ) {
    super(repository);
  }
}
