import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';
import { WhatsappConversationMessageRepository } from '../../../../database/repositories/whatsapp-conversation-message.repository';
import {
  PlannerOutput,
  RuntimeState,
} from '../../contracts/agentic-architecture.contracts';
import { estimateTokens } from '../conversation-context.service';
import { RecentMessageSelectorService } from './recent-message-selector.service';
import { CORE_SYSTEM_PROMPT } from '../../prompts/core-system-prompt';

export interface PromptComposerResult {
  messages: OpenAI.ChatCompletionMessageParam[];
  breakdown: {
    system_tokens: number;
    summary_tokens: number;
    memory_tokens: number;
    rag_tokens: number;
    recent_tokens: number;
    totalTokens: number;
  };
  recentCount: number;
}

@Injectable()
export class PromptComposerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly messageRepo: WhatsappConversationMessageRepository,
    private readonly recentSelector: RecentMessageSelectorService,
  ) {}

  async compose(input: {
    conversation: WhatsappConversation;
    runtimeState: RuntimeState;
    planner: PlannerOutput;
    ragContext?: string | null;
    userInfo?: {
      id: string;
      name?: string | null;
      role?: string | null;
      isDoctor?: boolean;
      ownerId?: string | null;
      accessibleDoctors?: Array<{ id: string; name?: string | null }>;
    } | null;
  }): Promise<PromptComposerResult> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    const breakdown = {
      system_tokens: 0,
      summary_tokens: 0,
      memory_tokens: 0,
      rag_tokens: 0,
      recent_tokens: 0,
      totalTokens: 0,
    };

    const blocks = [
      CORE_SYSTEM_PROMPT,
      this.buildUserBlock(input.userInfo),
      this.buildRuntimeBlock(input.runtimeState, input.planner),
      this.buildSummaryBlock(input.conversation),
      this.buildMemoryBlock(input.conversation),
      input.ragContext ? `RAG_RELEVANTE:\n${input.ragContext}` : null,
    ].filter(
      (value): value is string => typeof value === 'string' && !!value.trim(),
    );

    for (const block of blocks) {
      messages.push({ role: 'system', content: block });
      const tokens = estimateTokens(block);
      if (
        block === CORE_SYSTEM_PROMPT ||
        block.startsWith('USUARIO_ATUAL') ||
        block.startsWith('RUNTIME_ATUAL')
      ) {
        breakdown.system_tokens += tokens;
      } else if (block.startsWith('RESUMO_CONVERSA')) {
        breakdown.summary_tokens += tokens;
      } else if (block.startsWith('MEMORIA_ESTRUTURADA')) {
        breakdown.memory_tokens += tokens;
      } else if (block.startsWith('RAG_RELEVANTE')) {
        breakdown.rag_tokens += tokens;
      } else {
        breakdown.system_tokens += tokens;
      }
    }

    const limit = this.configService.get<number>('AI_MAX_RECENT_MESSAGES', 8);
    const recentRows = await this.messageRepo.findRecentByConversation(
      input.conversation.id,
      Math.max(limit * 2, limit),
    );
    const recent = this.recentSelector.select(
      recentRows.map((row) => ({
        role: row.role,
        content: row.content,
        toolName: row.toolName,
      })),
      limit,
      [
        input.runtimeState.pendingDocument?.fileName || '',
        input.runtimeState.pendingConfirmation?.tool || '',
        ...(input.runtimeState.missingFields || []),
      ],
    );

    for (const recentMessage of recent) {
      const role: 'user' | 'assistant' =
        recentMessage.role === 'user' ? 'user' : 'assistant';
      const content =
        recentMessage.role === 'tool'
          ? `[tool:${(recentMessage as { toolName?: string | null }).toolName || 'resultado'}] ${recentMessage.content}`
          : recentMessage.content;
      messages.push({
        role,
        content,
      });
      breakdown.recent_tokens += estimateTokens(content);
    }

    breakdown.totalTokens =
      breakdown.system_tokens +
      breakdown.summary_tokens +
      breakdown.memory_tokens +
      breakdown.rag_tokens +
      breakdown.recent_tokens;

    return {
      messages: this.trimToBudget(messages, breakdown),
      breakdown,
      recentCount: recent.length,
    };
  }

  private buildUserBlock(
    userInfo:
      | {
          id: string;
          name?: string | null;
          role?: string | null;
          isDoctor?: boolean;
          ownerId?: string | null;
          accessibleDoctors?: Array<{ id: string; name?: string | null }>;
        }
      | null
      | undefined,
  ): string | null {
    if (!userInfo?.id) return null;
    return [
      'USUARIO_ATUAL:',
      `id=${userInfo.id}`,
      userInfo.name ? `nome=${userInfo.name}` : null,
      userInfo.role ? `role=${userInfo.role}` : null,
      userInfo.ownerId ? `ownerId=${userInfo.ownerId}` : null,
      userInfo.isDoctor ? 'isDoctor=true' : null,
      userInfo.accessibleDoctors?.length
        ? `doctors=${userInfo.accessibleDoctors.map((doctor) => `${doctor.name || 'sem_nome'}:${doctor.id}`).join(';')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildRuntimeBlock(
    runtimeState: RuntimeState,
    planner: PlannerOutput,
  ): string {
    return [
      'RUNTIME_ATUAL:',
      `workflow=${runtimeState.activeWorkflow}`,
      `draft=${runtimeState.activeDraft ?? 'none'}`,
      `missing=${runtimeState.missingFields.join(',') || 'none'}`,
      `riskFlags=${runtimeState.riskFlags.map((flag) => flag.code).join(',') || 'none'}`,
      `plannerIntent=${planner.intent}`,
      `plannerTool=${planner.toolCandidate ?? 'none'}`,
      `plannerConfidence=${planner.confidence}`,
    ].join('\n');
  }

  private buildSummaryBlock(conversation: WhatsappConversation): string | null {
    if (!conversation.conversationSummary?.trim()) return null;
    return `RESUMO_CONVERSA:\n${conversation.conversationSummary.trim()}`;
  }

  private buildMemoryBlock(conversation: WhatsappConversation): string | null {
    const memory = conversation.conversationMemory || {};
    if (!Object.keys(memory).length) return null;
    const compactMemory = {
      intent: memory.intent,
      last_user_goal: memory.last_user_goal,
      pending_confirmation: memory.pending_confirmation,
      awaitingMedia: memory.awaitingMedia,
      filled_slots: memory.filled_slots,
      surgeryRequest: memory.surgeryRequest,
    };
    return `MEMORIA_ESTRUTURADA:\n${JSON.stringify(compactMemory)}`;
  }

  private trimToBudget(
    messages: OpenAI.ChatCompletionMessageParam[],
    breakdown: PromptComposerResult['breakdown'],
  ): OpenAI.ChatCompletionMessageParam[] {
    const budget = this.configService.get<number>(
      'AI_CONTEXT_TOKEN_BUDGET',
      3200,
    );
    if (breakdown.totalTokens <= budget) return messages;

    const systemMessages = messages.filter(
      (message) => message.role === 'system',
    );
    const nonSystemMessages = messages.filter(
      (message) => message.role !== 'system',
    );
    while (
      nonSystemMessages.length > 3 &&
      systemMessages.length + nonSystemMessages.length > 0 &&
      breakdown.totalTokens > budget
    ) {
      const removed = nonSystemMessages.shift();
      breakdown.totalTokens -= estimateTokens(String(removed?.content || ''));
      breakdown.recent_tokens = Math.max(
        0,
        breakdown.recent_tokens -
          estimateTokens(String(removed?.content || '')),
      );
    }

    return [...systemMessages, ...nonSystemMessages];
  }
}
