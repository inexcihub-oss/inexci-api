import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  WhatsappConversation,
  ConversationMessage,
} from '../../../database/entities/whatsapp-conversation.entity';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationRepo: WhatsappConversationRepository,
    private readonly messageRepo: WhatsappConversationMessageRepository,
    private readonly configService: ConfigService,
  ) {}

  async getOrCreateConversation(
    phone: string,
    userId: string | null,
    accountId?: string | null,
  ): Promise<WhatsappConversation> {
    const conv = await this.conversationRepo.findActiveByPhone(
      phone,
      accountId || undefined,
    );

    if (conv && !this.isExpired(conv)) {
      return conv;
    }

    if (conv) {
      await this.conversationRepo.deactivateOldConversations(phone);
    }

    return this.conversationRepo.create({
      phone,
      userId,
      accountId: accountId || null,
      messagesHistory: [],
      startedAt: new Date(),
      lastMessageAt: new Date(),
      active: true,
    });
  }

  async appendMessage(
    conversationId: string,
    role: ConversationMessage['role'],
    content: string,
    toolName?: string,
    metadata?: ConversationMessage['metadata'],
  ): Promise<void> {
    const conv = await this.conversationRepo.findOne({ id: conversationId });
    if (!conv) return;

    const maxHistory = this.configService.get<number>(
      'AI_MAX_CONVERSATION_HISTORY',
      20,
    );

    const message: ConversationMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(toolName ? { tool_name: toolName } : {}),
      ...(metadata ? { metadata } : {}),
    };

    // T22: Gravar na tabela filha (principal)
    await this.messageRepo.create({
      conversationId,
      role,
      content,
      toolName: toolName || null,
      metadata: metadata || null,
    });

    // T23: Manter messages_history jsonb como deprecated (compatibilidade)
    const history = [...(conv.messagesHistory || []), message];
    const trimmedHistory =
      history.length > maxHistory ? history.slice(-maxHistory) : history;

    await this.conversationRepo.update(conversationId, {
      messagesHistory: trimmedHistory,
      lastMessageAt: new Date(),
    });
  }

  async resetConversationHistory(conversationId: string): Promise<void> {
    const conv = await this.conversationRepo.findOne({ id: conversationId });
    if (!conv) return;

    const now = new Date();
    await this.conversationRepo.update(conversationId, {
      messagesHistory: [],
      startedAt: now,
      lastMessageAt: now,
      conversationSummary: null,
      conversationMemory: {},
      summaryUpdatedAt: null,
    });
  }

  // T22/T24: Constrói mensagens para a OpenAI a partir da tabela filha com LIMIT
  buildMessagesForOpenAI(
    conversation: WhatsappConversation,
    ragContext?: string,
    recentMessages?: Array<{ role: string; content: string }>,
  ): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    if (ragContext) {
      messages.push({
        role: 'system',
        content: `CONTEXTO RELEVANTE DA BASE DE CONHECIMENTO:\n${ragContext}`,
      });
    }

    if (conversation.userId) {
      messages.push({
        role: 'system',
        content: `USUÁRIO ATUAL: ID=${conversation.userId}, Telefone=${conversation.phone}`,
      });
    }

    // Usa mensagens da tabela filha se disponíveis, senão fallback para jsonb
    const historySource = recentMessages || conversation.messagesHistory || [];
    for (const msg of historySource) {
      messages.push({ role: msg.role as any, content: msg.content });
    }

    return messages;
  }

  // T24: Carrega as últimas N mensagens da tabela filha
  async loadRecentMessages(
    conversationId: string,
    limit?: number,
  ): Promise<Array<{ role: string; content: string }>> {
    const maxHistory =
      limit ||
      this.configService.get<number>('AI_MAX_CONVERSATION_HISTORY', 20);

    const rows = await this.messageRepo.findRecentByConversation(
      conversationId,
      maxHistory,
    );

    return rows.map((r) => ({ role: r.role, content: r.content }));
  }

  /**
   * Carrega janela curta para envio ao LLM, aplicando AI_MAX_RECENT_MESSAGES
   * em vez de AI_MAX_CONVERSATION_HISTORY. Mantém o histórico bruto para
   * auditoria, mas envia apenas as últimas N (default 10) ao modelo.
   */
  async loadRecentForLlm(
    conversationId: string,
    max?: number,
  ): Promise<Array<{ role: string; content: string }>> {
    const limit =
      max ?? this.configService.get<number>('AI_MAX_RECENT_MESSAGES', 10);
    return this.loadRecentMessages(conversationId, limit);
  }

  private isExpired(conv: WhatsappConversation): boolean {
    const timeout = this.configService.get<number>(
      'AI_SESSION_TIMEOUT_MINUTES',
      30,
    );
    const diff = Date.now() - new Date(conv.lastMessageAt).getTime();
    return diff > timeout * 60 * 1000;
  }
}
