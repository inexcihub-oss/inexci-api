import { Injectable } from '@nestjs/common';

/**
 * TTL da pending de "limpar contexto" — após esse tempo a confirmação
 * expira silenciosamente e um "sim" do usuário deixa de quebrar o histórico.
 */
export const CLEAR_CONTEXT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

/**
 * Comandos exatos que disparam o fluxo de limpeza de contexto. Match exato
 * em texto normalizado (sem acentos, lowercase, espaços colapsados). Para
 * variações com sufixo (ex.: "limpar contexto da conversa") usamos
 * `startsWith` em `isClearContextCommand`.
 */
export const CLEAR_CONTEXT_EXACT_COMMANDS = new Set<string>([
  'limpar contexto',
  'limpar o contexto',
  'limpar conversa',
  'limpar a conversa',
  'limpar contexto da conversa',
  'limpar historico',
  'limpar histórico',
  'limpar o historico',
  'limpar o histórico',
  'limpar historico da conversa',
  'limpar histórico da conversa',
  'limpar chat',
  'limpar o chat',
  'apagar contexto',
  'apagar historico',
  'apagar histórico',
  'resetar contexto',
  'resetar conversa',
  'sair da conversa',
  'sair do chat',
  'encerrar conversa',
  'encerrar chat',
  'fechar conversa',
  'nova conversa',
  'comecar nova conversa',
  'começar nova conversa',
  'finalizar conversa',
]);

interface PendingClearContextConfirmation {
  conversationId: string;
  expiresAt: number;
}

export type ClearContextOutcome =
  | { status: 'none' }
  | { status: 'prompt'; message: string }
  | { status: 'confirmed'; conversationId: string; message: string }
  | { status: 'cancelled'; message: string }
  | { status: 'reprompt'; message: string };

const CONFIRMATION_INPUTS = new Set<string>([
  'sim',
  'confirmo',
  'confirmar',
  'pode limpar',
  'limpar',
]);

const CANCEL_INPUTS = new Set<string>([
  'nao',
  'não',
  'cancelar',
  'cancela',
  'deixa assim',
  'nao limpar',
  'não limpar',
]);

/**
 * Encapsula o fluxo de "limpar contexto" — detecta o comando, mantém a
 * pending de confirmação por telefone e responde ao "sim/não" do usuário.
 *
 * Métodos públicos:
 *  - `isClearContextCommand` — detecta no input normalizado.
 *  - `isConfirmationInput` / `isCancelConfirmationInput` — também
 *    reaproveitados pelo guard de RAG (skip em inputs triviais).
 *  - `tryHandleClearContext(phone, normalizedInput, conversationId)` —
 *    se for comando, registra a pending e devolve a mensagem de prompt.
 *  - `tryHandleClearContextConfirmation(phone, normalizedInput)` — se há
 *    pending para esse telefone, processa "sim/não" ou pede reprompt.
 *
 * Estado interno: `pendingClearContextByPhone` (in-memory, TTL
 * `CLEAR_CONTEXT_CONFIRMATION_TTL_MS`). Não persiste em Redis: a janela
 * é curta e a perda em restart é aceitável.
 *
 * Extraído do `AiOrchestratorService` na Fase 1 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`.
 */
@Injectable()
export class ClearContextDetectorService {
  private readonly pendingClearContextByPhone = new Map<
    string,
    PendingClearContextConfirmation
  >();

  /**
   * Normaliza texto de entrada: remove acentos, converte para lowercase e
   * colapsa espaços. Resultado idempotente — pode ser chamado múltiplas vezes.
   */
  normalizeText(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  isClearContextCommand(normalizedInput: string): boolean {
    if (!normalizedInput) return false;
    if (CLEAR_CONTEXT_EXACT_COMMANDS.has(normalizedInput)) return true;

    return (
      normalizedInput.startsWith('limpar contexto') ||
      normalizedInput.startsWith('limpar conversa') ||
      normalizedInput.startsWith('limpar historico') ||
      normalizedInput.startsWith('limpar chat') ||
      normalizedInput.startsWith('apagar contexto') ||
      normalizedInput.startsWith('apagar historico') ||
      normalizedInput.startsWith('resetar contexto') ||
      normalizedInput.startsWith('resetar conversa')
    );
  }

  isConfirmationInput(normalizedInput: string): boolean {
    return CONFIRMATION_INPUTS.has(normalizedInput);
  }

  isCancelConfirmationInput(normalizedInput: string): boolean {
    return CANCEL_INPUTS.has(normalizedInput);
  }

  /**
   * Se o input for um comando de limpeza, registra a pending e devolve
   * `{ status: 'prompt', message }`. Caso contrário devolve `{ status: 'none' }`.
   */
  tryHandleClearContext(
    phone: string,
    normalizedInput: string,
    conversationId: string,
  ): ClearContextOutcome {
    if (!this.isClearContextCommand(normalizedInput)) return { status: 'none' };

    this.pendingClearContextByPhone.set(phone, {
      conversationId,
      expiresAt: Date.now() + CLEAR_CONTEXT_CONFIRMATION_TTL_MS,
    });

    return {
      status: 'prompt',
      message:
        'Confirma que deseja limpar o contexto desta conversa? As próximas mensagens serão tratadas sem histórico anterior. Responda "sim" para confirmar ou "não" para cancelar.',
    };
  }

  /**
   * Se houver pending fresca para o telefone, processa o input:
   *  - confirmação → consome pending e devolve `confirmed` + conversationId.
   *  - cancelamento → consome pending e devolve `cancelled`.
   *  - qualquer outro texto → mantém pending e devolve `reprompt`.
   * Sem pending (ou expirada): `{ status: 'none' }`.
   */
  tryHandleClearContextConfirmation(
    phone: string,
    normalizedInput: string,
  ): ClearContextOutcome {
    const pending = this.getPendingClearContext(phone);
    if (!pending) return { status: 'none' };

    if (this.isConfirmationInput(normalizedInput)) {
      this.pendingClearContextByPhone.delete(phone);
      return {
        status: 'confirmed',
        conversationId: pending.conversationId,
        message:
          'Pronto. Limpei o contexto desta conversa. Precisa de mais alguma coisa? Se precisar, é só chamar.',
      };
    }

    if (this.isCancelConfirmationInput(normalizedInput)) {
      this.pendingClearContextByPhone.delete(phone);
      return {
        status: 'cancelled',
        message:
          'Tudo bem, não limpei o contexto. Se quiser limpar depois, é só pedir.',
      };
    }

    return {
      status: 'reprompt',
      message:
        'Ainda estou aguardando sua confirmação para limpar o contexto. Responda "sim" para confirmar ou "não" para cancelar.',
    };
  }

  private getPendingClearContext(
    phone: string,
  ): PendingClearContextConfirmation | null {
    const pending = this.pendingClearContextByPhone.get(phone);
    if (!pending) return null;

    if (Date.now() > pending.expiresAt) {
      this.pendingClearContextByPhone.delete(phone);
      return null;
    }

    return pending;
  }
}
