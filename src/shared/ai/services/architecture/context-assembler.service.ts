import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';
import {
  AudioCompressionResult,
  PlannerOutput,
  RuntimePendingDocument,
  RuntimeState,
} from '../../contracts/agentic-architecture.contracts';
import { ConversationContextService } from '../conversation-context.service';
import { MemoryProjectionService } from './memory-projection.service';
import {
  buildResponseStyleModule,
  buildToolPolicyModule,
  buildWorkflowModule,
  CORE_SYSTEM_PROMPT,
} from '../../prompts/core-system-prompt';

@Injectable()
export class ContextAssemblerService {
  constructor(
    private readonly legacyContextService: ConversationContextService,
    private readonly memoryProjection: MemoryProjectionService,
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
    breakdown: Awaited<ReturnType<ConversationContextService['buildContext']>>['breakdown'];
    strategy: Awaited<ReturnType<ConversationContextService['buildContext']>>['strategy'];
    recentCount: number;
  }> {
    const sanitizedConversation = {
      ...input.conversation,
      conversationMemory: {},
    } as WhatsappConversation;

    const base = await this.legacyContextService.buildContext({
      conversation: sanitizedConversation,
      ragContext: input.ragContext || null,
      systemPromptBase: CORE_SYSTEM_PROMPT,
      userInfo: input.userInfo || null,
    });

    const modules = this.buildSystemModules(input);
    const insertIndex = base.messages.findIndex((message) => message.role !== 'system');
    const nextMessages = [...base.messages];
    const targetIndex = insertIndex === -1 ? nextMessages.length : insertIndex;

    nextMessages.splice(
      targetIndex,
      0,
      ...modules.map(
        (content) =>
          ({
            role: 'system',
            content,
          }) satisfies OpenAI.ChatCompletionMessageParam,
      ),
    );

    base.breakdown.system_tokens += modules.reduce(
      (acc, item) => acc + Math.ceil(item.length / 4),
      0,
    );
    base.breakdown.totalTokens += modules.reduce(
      (acc, item) => acc + Math.ceil(item.length / 4),
      0,
    );

    return {
      messages: nextMessages,
      breakdown: base.breakdown,
      strategy: base.strategy,
      recentCount: base.recentCount,
    };
  }

  private buildSystemModules(input: {
    runtimeState: RuntimeState;
    planner: PlannerOutput;
    audioCompression?: AudioCompressionResult | null;
    pendingDocument?: RuntimePendingDocument | null;
    conversation: WhatsappConversation;
    userInfo?: { role?: string | null } | null;
  }): string[] {
    const modules: string[] = [];
    const workflowModule = buildWorkflowModule(input.runtimeState, input.planner);
    if (workflowModule) modules.push(workflowModule);

    modules.push(buildToolPolicyModule(input.runtimeState, input.planner));
    modules.push(buildResponseStyleModule());

    const persistent = this.memoryProjection.buildPersistentMemory(
      input.conversation.conversationMemory,
      input.userInfo?.role || null,
    );
    const shortTerm = this.memoryProjection.buildShortTermContext(
      input.conversation.conversationMemory,
    );
    modules.push(
      `MEMORIA_PERSISTENTE:\n${JSON.stringify(persistent)}`,
      `CONTEXTO_DE_CURTO_PRAZO:\n${JSON.stringify(shortTerm)}`,
      `RUNTIME_STATE:\n${JSON.stringify(input.runtimeState)}`,
      `PLANNER_OUTPUT:\n${JSON.stringify(input.planner)}`,
    );

    if (input.audioCompression) {
      modules.push(
        `AUDIO_SEMANTICO:\n${JSON.stringify({
          semanticTranscript: input.audioCompression.semanticTranscript,
          inferredIntent: input.audioCompression.inferredIntent,
          entities: input.audioCompression.extractedEntities,
          confidence: input.audioCompression.confidence,
        })}`,
      );
    }
    if (input.pendingDocument) {
      modules.push(`DOCUMENTO_PENDENTE:\n${JSON.stringify(input.pendingDocument)}`);
    }

    return modules;
  }
}
