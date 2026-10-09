import { Injectable } from '@nestjs/common';

export const CLEAR_CONTEXT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

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

@Injectable()
export class ClearContextDetectorService {
  private readonly pendingClearContextByPhone = new Map<
    string,
    PendingClearContextConfirmation
  >();

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
