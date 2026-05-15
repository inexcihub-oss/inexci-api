import { ConversationMemory } from '../../../database/entities/whatsapp-conversation.entity';

/**
 * Merge profundo (deep merge) determinístico para `conversationMemory`.
 *
 * Regra crítica (Fase 6 do Blueprint v3 — "summarization patch-only"):
 *   - O LLM NUNCA reescreve `conversationMemory` inteira. Ele só
 *     produz `conversation_summary` (texto puro). A memória estruturada
 *     é alimentada por handlers determinísticos (tools de mutação,
 *     Operational State, parsers).
 *   - Este merger é o ponto único de mutação. Mantém referência
 *     transparente: se um campo aparece como `null` na patch, é
 *     interpretado como "manter atual" — para apagar use `undefined`
 *     explicitamente removendo a chave.
 *
 * Listas de strings com a mesma chave são UNIDAS via `Set`. Objetos
 * são merged campo a campo. Demais tipos são SUBSTITUÍDOS.
 */
export function mergeConversationMemory(
  base: ConversationMemory | null | undefined,
  patch: Partial<ConversationMemory> | null | undefined,
): ConversationMemory {
  const baseMem = (base ?? {}) as Record<string, unknown>;
  const patchMem = (patch ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...baseMem };

  for (const [key, value] of Object.entries(patchMem)) {
    if (value === null) continue; // null = "manter atual"
    const current = out[key];

    if (Array.isArray(value) && Array.isArray(current)) {
      const allStrings =
        value.every((v) => typeof v === 'string') &&
        current.every((v) => typeof v === 'string');
      if (allStrings) {
        out[key] = Array.from(new Set([...(current as string[]), ...value]));
      } else {
        out[key] = value;
      }
      continue;
    }

    if (
      value &&
      current &&
      typeof value === 'object' &&
      typeof current === 'object' &&
      !Array.isArray(value) &&
      !Array.isArray(current)
    ) {
      out[key] = mergeConversationMemory(
        current as ConversationMemory,
        value as ConversationMemory,
      );
      continue;
    }

    out[key] = value;
  }

  return out as ConversationMemory;
}
