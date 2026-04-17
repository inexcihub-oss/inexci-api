import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiKnowledgeChunk } from '../entities/ai-knowledge-chunk.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AiKnowledgeChunkRepository extends BaseRepository<AiKnowledgeChunk> {
  constructor(
    @InjectRepository(AiKnowledgeChunk)
    repository: Repository<AiKnowledgeChunk>,
  ) {
    super(repository);
  }

  async findByCategory(category: string): Promise<AiKnowledgeChunk[]> {
    return this.repository.find({
      where: { category, active: true },
      order: { created_at: 'ASC' },
    });
  }

  async deactivateByCategory(category: string): Promise<void> {
    await this.repository.update({ category }, { active: false });
  }
}
