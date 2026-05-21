import { Injectable } from '@nestjs/common';
import { AiPersistentMemoryRepository } from '../../../../database/repositories/ai-persistent-memory.repository';
import {
  AiPersistentMemory,
  AiPersistentMemoryScope,
} from '../../../../database/entities/ai-persistent-memory.entity';

@Injectable()
export class PersistentMemoryService {
  constructor(private readonly repository: AiPersistentMemoryRepository) {}

  async loadByUser(
    userId: string | null | undefined,
  ): Promise<AiPersistentMemory[]> {
    if (!userId) return [];
    return this.repository.findMany({ userId } as any, 0, 50);
  }

  async remember(input: {
    userId: string | null | undefined;
    scope: AiPersistentMemoryScope;
    key: string;
    value: Record<string, unknown>;
    confidence?: number;
    expiresAt?: Date | null;
  }): Promise<void> {
    if (!input.userId || !input.key.trim()) return;
    const existing = await this.repository.findOne({
      userId: input.userId,
      scope: input.scope,
      key: input.key,
    } as any);

    if (existing) {
      await this.repository.update(existing.id, {
        value: {
          ...(existing.value || {}),
          ...input.value,
        },
        confidence: input.confidence ?? existing.confidence,
        lastAccessedAt: new Date(),
        expiresAt: input.expiresAt ?? existing.expiresAt,
      } as any);
      return;
    }

    await this.repository.create({
      userId: input.userId,
      scope: input.scope,
      key: input.key,
      value: input.value,
      confidence: input.confidence ?? 0.7,
      lastAccessedAt: new Date(),
      expiresAt: input.expiresAt ?? null,
    } as any);
  }

  toPromptHints(rows: AiPersistentMemory[]): string[] {
    return rows
      .filter((row) => !row.expiresAt || row.expiresAt.getTime() > Date.now())
      .slice(0, 10)
      .map((row) => `${row.scope}:${row.key}=${JSON.stringify(row.value)}`);
  }
}
