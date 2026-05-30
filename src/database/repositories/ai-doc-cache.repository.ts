import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AiDocCache } from '../entities/ai-doc-cache.entity';

/**
 * Repositório para o cache de OCR/classificação por SHA256.
 * Não estende `BaseRepository` porque a PK é `sha256` (não há `id`).
 */
@Injectable()
export class AiDocCacheRepository {
  constructor(
    @InjectRepository(AiDocCache)
    private readonly repository: Repository<AiDocCache>,
  ) {}

  findByHash(sha256: string): Promise<AiDocCache | null> {
    return this.repository.findOne({ where: { sha256 } });
  }

  async save(input: Partial<AiDocCache>): Promise<AiDocCache> {
    const entity = this.repository.create(input);
    return this.repository.save(entity);
  }

  async incrementHit(sha256: string): Promise<void> {
    await this.repository.update(
      { sha256 },
      { lastHitAt: new Date(), hitCount: () => 'hit_count + 1' as any },
    );
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.repository.delete({ createdAt: LessThan(date) });
    return result.affected ?? 0;
  }
}
