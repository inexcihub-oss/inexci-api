import { Injectable, Logger } from '@nestjs/common';
import { AiPersistentMemoryRepository } from '../../../database/repositories/ai-persistent-memory.repository';
import { AiPersistentMemoryScope } from '../../../database/entities/ai-persistent-memory.entity';

/**
 * Façade do `AiPersistentMemoryRepository` (Fase 6 do Blueprint v3).
 *
 * Política:
 *   - 100% por `user_id` (nunca por owner_id) — preferências são pessoais.
 *   - Apenas chaves estruturadas (preferências, entidades, padrões, metas).
 *   - Texto livre vai para `conversation_summary`/`conversation_memory`,
 *     NUNCA aqui.
 *   - Falha-segura: erros não bloqueiam o turno (log + return).
 */
@Injectable()
export class PersistentMemoryService {
  private readonly logger = new Logger(PersistentMemoryService.name);

  constructor(private readonly repo: AiPersistentMemoryRepository) {}

  /**
   * Devolve um objeto plain `{ scope: { key: value } }` pronto para
   * injetar em `OperationalState.persistentHints`. Limita a 12 entradas.
   */
  async loadHints(userId: string): Promise<Record<string, unknown>> {
    if (!userId) return {};
    try {
      const rows = await this.repo.listRecent(userId, { limit: 12 });
      const hints: Record<string, unknown> = {};
      for (const row of rows) {
        const bucket =
          (hints[row.scope] as Record<string, unknown> | undefined) ?? {};
        bucket[row.key] = row.value;
        hints[row.scope] = bucket;
      }
      return hints;
    } catch (err: any) {
      this.logger.warn(
        `[PERSISTENT_MEMORY] falha ao carregar hints user=${userId.slice(0, 8)}: ${err?.message || err}`,
      );
      return {};
    }
  }

  async remember(input: {
    userId: string;
    scope: AiPersistentMemoryScope;
    key: string;
    value: unknown;
    confidence?: number;
  }): Promise<void> {
    if (!input.userId) return;
    try {
      await this.repo.upsert(input);
    } catch (err: any) {
      this.logger.warn(
        `[PERSISTENT_MEMORY] falha ao gravar user=${input.userId.slice(0, 8)} scope=${input.scope} key=${input.key}: ${err?.message || err}`,
      );
    }
  }

  async forget(input: {
    userId: string;
    scope: AiPersistentMemoryScope;
    key: string;
  }): Promise<void> {
    try {
      await this.repo.delete(input);
    } catch (err: any) {
      this.logger.warn(
        `[PERSISTENT_MEMORY] falha ao apagar user=${input.userId.slice(0, 8)}: ${err?.message || err}`,
      );
    }
  }
}
