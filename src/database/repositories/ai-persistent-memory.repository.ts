import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiPersistentMemory } from '../entities/ai-persistent-memory.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AiPersistentMemoryRepository extends BaseRepository<AiPersistentMemory> {
  constructor(
    @InjectRepository(AiPersistentMemory)
    repository: Repository<AiPersistentMemory>,
  ) {
    super(repository);
  }
}
