import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  WhatsappConversation,
  ConversationMessage,
} from '../../../database/entities/whatsapp-conversation.entity';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationRepo: WhatsappConversationRepository,
    private readonly configService: ConfigService,
  ) {}

  async getOrCreateConversation(
    phone: string,
    userId: string | null,
  ): Promise<WhatsappConversation> {
    const conv = await this.conversationRepo.findActiveByPhone(phone);

    if (conv && !this.isExpired(conv)) {
      return conv;
    }

    if (conv) {
      await this.conversationRepo.deactivateOldConversations(phone);
    }

    return this.conversationRepo.create({
      phone,
      user_id: userId,
      messages_history: [],
      started_at: new Date(),
      last_message_at: new Date(),
      active: true,
    });
  }

  async appendMessage(
    conversationId: string,
    role: ConversationMessage['role'],
    content: string,
    toolName?: string,
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
    };

    const history = [...(conv.messages_history || []), message];
    const trimmedHistory =
      history.length > maxHistory ? history.slice(-maxHistory) : history;

    await this.conversationRepo.update(conversationId, {
      messages_history: trimmedHistory,
      last_message_at: new Date(),
    });
  }

  buildMessagesForOpenAI(
    conversation: WhatsappConversation,
    ragContext?: string,
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

    if (conversation.user_id) {
      messages.push({
        role: 'system',
        content: `USUÁRIO ATUAL: ID=${conversation.user_id}, Telefone=${conversation.phone}`,
      });
    }

    for (const msg of conversation.messages_history || []) {
      messages.push({ role: msg.role as any, content: msg.content });
    }

    return messages;
  }

  private isExpired(conv: WhatsappConversation): boolean {
    const timeout = this.configService.get<number>(
      'AI_SESSION_TIMEOUT_MINUTES',
      30,
    );
    const diff = Date.now() - new Date(conv.last_message_at).getTime();
    return diff > timeout * 60 * 1000;
  }
}
