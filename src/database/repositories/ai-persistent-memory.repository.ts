import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiPersistentMemory,
  AiPersistentMemoryScope,
} from '../entities/ai-persistent-memory.entity';

@Injectable()
export class AiPersistentMemoryRepository {
  constructor(
    @InjectRepository(AiPersistentMemory)
    private readonly repo: Repository<AiPersistentMemory>,
  ) {}

  /**
   * Lista preferências e entidades RECENTES (last_used_at < 90 dias).
   * Limite default 12 — suficiente para o operational state.
   */
  async listRecent(
    userId: string,
    options: { limit?: number; scope?: AiPersistentMemoryScope } = {},
  ): Promise<AiPersistentMemory[]> {
    const limit = options.limit ?? 12;
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const qb = this.repo
      .createQueryBuilder('m')
      .where('m.user_id = :userId', { userId })
      .andWhere('m.last_used_at >= :cutoff', { cutoff })
      .orderBy('m.last_used_at', 'DESC')
      .limit(limit);
    if (options.scope) {
      qb.andWhere('m.scope = :scope', { scope: options.scope });
    }
    return qb.getMany();
  }

  /** Upsert idempotente; incrementa `use_count` e atualiza `last_used_at`. */
  async upsert(input: {
    userId: string;
    scope: AiPersistentMemoryScope;
    key: string;
    value: unknown;
    confidence?: number | null;
  }): Promise<void> {
    const serializedValue = JSON.stringify(input.value ?? null);

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(AiPersistentMemory)
      .values({
        userId: input.userId,
        scope: input.scope,
        key: input.key,
        value: () => ':memory_value::jsonb',
        confidence: input.confidence ?? null,
        lastUsedAt: new Date(),
        useCount: 1,
      })
      .orUpdate(
        ['value', 'confidence', 'last_used_at', 'use_count'],
        ['user_id', 'scope', 'key'],
      )
      .setParameter('memory_value', serializedValue)
      .setParameter('use_count_inc', 1)
      .execute();

    // ON CONFLICT incrementa via update separado (TypeOrm não dá expr SQL aqui).
    await this.repo
      .createQueryBuilder()
      .update(AiPersistentMemory)
      .set({
        useCount: () => '"use_count" + 1',
        lastUsedAt: new Date(),
      })
      .where('user_id = :userId AND scope = :scope AND key = :key', {
        userId: input.userId,
        scope: input.scope,
        key: input.key,
      })
      .execute();
  }

  async delete(input: {
    userId: string;
    scope: AiPersistentMemoryScope;
    key: string;
  }): Promise<void> {
    await this.repo.delete(input);
  }
}
