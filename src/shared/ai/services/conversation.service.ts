import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WhatsappConversation,
  ConversationMessage,
} from '../../../database/entities/whatsapp-conversation.entity';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';

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
    ownerId?: string | null,
  ): Promise<WhatsappConversation> {
    const conv = await this.conversationRepo.findActiveByPhone(
      phone,
      ownerId || undefined,
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
      ownerId: ownerId || null,
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

    await this.messageRepo.create({
      conversationId,
      role,
      content,
      toolName: toolName || null,
      metadata: metadata || null,
    });

    await this.conversationRepo.update(conversationId, {
      lastMessageAt: new Date(),
    });
  }

  async resetConversationHistory(conversationId: string): Promise<void> {
    const conv = await this.conversationRepo.findOne({ id: conversationId });
    if (!conv) return;

    const now = new Date();
    // Histórico bruto vive em `whatsapp_conversation_messages`. Apagamos as
    // mensagens da conversa para "zerar" o contexto do LLM no próximo turno.
    await this.messageRepo.deleteByConversation(conversationId);
    await this.conversationRepo.update(conversationId, {
      startedAt: now,
      lastMessageAt: now,
      conversationSummary: null,
      conversationMemory: {},
      summaryUpdatedAt: null,
    });
  }

  /**
   * Carrega janela curta de mensagens recentes para envio ao LLM, aplicando
   * `AI_MAX_RECENT_MESSAGES` (default 10). Histórico completo permanece na
   * tabela filha (`whatsapp_conversation_message`) para auditoria.
   */
  async loadRecentForLlm(
    conversationId: string,
    max?: number,
  ): Promise<Array<{ role: string; content: string }>> {
    const limit =
      max ?? this.configService.get<number>('AI_MAX_RECENT_MESSAGES', 10);
    const rows = await this.messageRepo.findRecentByConversation(
      conversationId,
      limit,
    );
    return rows.map((r) => ({ role: r.role, content: r.content }));
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
