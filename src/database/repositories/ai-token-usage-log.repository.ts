import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTokenUsageLog } from '../entities/ai-token-usage-log.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AiTokenUsageLogRepository extends BaseRepository<AiTokenUsageLog> {
  constructor(
    @InjectRepository(AiTokenUsageLog)
    repository: Repository<AiTokenUsageLog>,
  ) {
    super(repository);
  }
}
