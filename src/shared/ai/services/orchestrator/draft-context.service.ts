import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OperationDraftService } from '../operation-draft.service';
import { ToolRegistryService } from '../tool-registry.service';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { PROMPT_VERSION } from '../../prompts/system-prompt';

const COMPLEX_MUTATION_TOOL_NAMES = new Set<string>([]);

@Injectable()
export class DraftContextService {
  private readonly logger = new Logger(DraftContextService.name);

  constructor(
    private readonly operationDraftService: OperationDraftService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly configService: ConfigService,
  ) {}

  async buildToolsForDraft(conversationId: string): Promise<{
    tools: OpenAI.ChatCompletionTool[];
    draftType: OperationDraftType | null;
  }> {
    let activeDraftType: OperationDraftType | null = null;
    try {
      const current =
        await this.operationDraftService.getCurrent(conversationId);
      activeDraftType = current?.type ?? null;
    } catch (err) {
      this.logger.warn(
        `[TOOLS_FILTER] falha ao consultar draft conv=${conversationId}: ${String(
          (err as Error)?.message ?? err,
        )}`,
      );
    }
    return {
      tools: this.toolRegistry.getToolDefinitionsForDraft(activeDraftType),
      draftType: activeDraftType,
    };
  }

  buildCacheKey(activeDraftType: OperationDraftType | null): string {
    return `inexci:wa:v${PROMPT_VERSION}:draft=${activeDraftType ?? 'none'}`;
  }

  async evaluatePlanFirstGuard(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined,
    conversationId: string,
  ): Promise<Set<string>> {
    const blocked = new Set<string>();
    if (!toolCalls?.length) return blocked;

    const flagValue = String(
      this.configService.get<string>('AI_USE_DRAFT_FLOWS', 'true'),
    ).toLowerCase();
    if (flagValue !== 'true' && flagValue !== '1') return blocked;

    const calledPlanActions = toolCalls.some(
      (call) => call.function?.name === 'plan_actions',
    );
    if (calledPlanActions) return blocked;

    let draftActive = false;
    try {
      const current =
        await this.operationDraftService.getCurrent(conversationId);
      draftActive = !!current;
    } catch (err) {
      this.logger.warn(
        `[PLAN_GUARD] falha ao consultar operation_draft conv=${conversationId}: ${String((err as Error)?.message ?? err)}`,
      );
    }
    if (draftActive) return blocked;

    for (const call of toolCalls) {
      const name = call.function?.name;
      if (name && COMPLEX_MUTATION_TOOL_NAMES.has(name)) {
        blocked.add(call.id);
      }
    }
    return blocked;
  }
}
