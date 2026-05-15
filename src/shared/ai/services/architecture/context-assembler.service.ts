import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';
import {
  AudioCompressionResult,
  PlannerOutput,
  RuntimePendingDocument,
  RuntimeState,
} from '../../contracts/agentic-architecture.contracts';
import { MemoryProjectionService } from './memory-projection.service';
import { PromptComposerService } from '../context/prompt-composer.service';
import { PersistentMemoryService } from '../memory/persistent-memory.service';

@Injectable()
export class ContextAssemblerService {
  constructor(
    private readonly promptComposer: PromptComposerService,
    private readonly memoryProjection: MemoryProjectionService,
    private readonly persistentMemory: PersistentMemoryService,
  ) {}

  async buildContext(input: {
    conversation: WhatsappConversation;
    ragContext?: string | null;
    userInfo?: {
      id: string;
      name?: string | null;
      role?: string | null;
      isDoctor?: boolean;
      ownerId?: string | null;
      accessibleDoctors?: Array<{ id: string; name?: string | null }>;
    } | null;
    runtimeState: RuntimeState;
    planner: PlannerOutput;
    audioCompression?: AudioCompressionResult | null;
    pendingDocument?: RuntimePendingDocument | null;
  }): Promise<{
    messages: OpenAI.ChatCompletionMessageParam[];
    breakdown: {
      system_tokens: number;
      summary_tokens: number;
      memory_tokens: number;
      rag_tokens: number;
      recent_tokens: number;
      totalTokens: number;
    };
    strategy: 'hybrid';
    recentCount: number;
  }> {
    const persistentRows = await this.persistentMemory.loadByUser(
      input.userInfo?.id,
    );
    const persistentHints = this.persistentMemory.toPromptHints(persistentRows);
    const projectedPersistent = this.memoryProjection.buildPersistentMemory(
      input.conversation.conversationMemory,
      input.userInfo?.role || null,
    );
    const projectedShortTerm = this.memoryProjection.buildShortTermContext(
      input.conversation.conversationMemory,
    );

    const composer = await this.promptComposer.compose({
      conversation: {
        ...input.conversation,
        conversationMemory: {
          ...((input.conversation.conversationMemory as Record<
            string,
            unknown
          >) || {}),
          projectedPersistent,
          projectedShortTerm,
          persistentHints,
          audioCompression: input.audioCompression
            ? {
                semanticTranscript: input.audioCompression.semanticTranscript,
                inferredIntent: input.audioCompression.inferredIntent,
                confidence: input.audioCompression.confidence,
              }
            : undefined,
          pendingDocument: input.pendingDocument || undefined,
        },
      } as WhatsappConversation,
      ragContext: input.ragContext || null,
      runtimeState: input.runtimeState,
      planner: input.planner,
      userInfo: input.userInfo || null,
    });

    return {
      messages: composer.messages,
      breakdown: composer.breakdown,
      strategy: 'hybrid',
      recentCount: composer.recentCount,
    };
  }
}
