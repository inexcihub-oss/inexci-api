import { Injectable } from '@nestjs/common';

export interface SelectableMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  createdAt: Date;
}

/**
 * Seletor priorizado de mensagens recentes (Fase 6 do Blueprint v3).
 *
 * Substitui o slice puro `loadRecentForLlm` por uma seleção que:
 *   1. Garante a última mensagem `user` (sempre).
 *   2. Inclui resultados estruturados de tool (com `toolName`) recentes.
 *   3. Inclui mensagens que mencionam entidades-chave (IDs, refs, palavras de drafts).
 *   4. Preenche o budget restante com mensagens mais recentes.
 *
 * Resultado em ordem cronológica (oldest → newest), pronto para
 * concat com o system prompt e enviado ao LLM.
 */
@Injectable()
export class RecentMessageSelector {
  select(input: {
    messages: SelectableMessage[];
    /** Limite máximo de mensagens (não é tokens — só count). */
    maxCount: number;
    /** Entidades-âncora extraídas do estado (IDs, refs). */
    anchors?: string[];
  }): SelectableMessage[] {
    const { messages, maxCount } = input;
    if (messages.length <= maxCount) return messages;

    const sortedAsc = [...messages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const lowerAnchors = (input.anchors ?? [])
      .filter((a) => typeof a === 'string' && a.length > 1)
      .map((a) => a.toLowerCase());

    const chosen = new Set<number>();

    // 1. Última user
    for (let i = sortedAsc.length - 1; i >= 0; i--) {
      if (sortedAsc[i].role === 'user') {
        chosen.add(i);
        break;
      }
    }

    // 2. Tool calls recentes (até 4)
    let toolHits = 0;
    for (let i = sortedAsc.length - 1; i >= 0 && toolHits < 4; i--) {
      if (chosen.has(i)) continue;
      if (sortedAsc[i].role === 'tool' || sortedAsc[i].toolName) {
        chosen.add(i);
        toolHits += 1;
      }
    }

    // 3. Mensagens que mencionam âncoras (até 4)
    let anchorHits = 0;
    if (lowerAnchors.length) {
      for (let i = sortedAsc.length - 1; i >= 0 && anchorHits < 4; i--) {
        if (chosen.has(i)) continue;
        const lower = sortedAsc[i].content.toLowerCase();
        if (lowerAnchors.some((a) => lower.includes(a))) {
          chosen.add(i);
          anchorHits += 1;
        }
      }
    }

    // 4. Preenche restantes com mensagens mais novas.
    for (let i = sortedAsc.length - 1; i >= 0 && chosen.size < maxCount; i--) {
      chosen.add(i);
    }

    const indices = [...chosen].sort((a, b) => a - b);
    return indices.map((i) => sortedAsc[i]);
  }
}
