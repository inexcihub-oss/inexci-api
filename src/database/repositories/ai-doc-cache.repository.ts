import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiDocCache } from '../entities/ai-doc-cache.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AiDocCacheRepository extends BaseRepository<AiDocCache> {
  constructor(
    @InjectRepository(AiDocCache)
    repository: Repository<AiDocCache>,
  ) {
    super(repository);
  }
}
