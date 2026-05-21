import { Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';
import { OperationDraftService } from '../operation-draft.service';
import { ToolRegistryService } from '../tool-registry.service';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { PROMPT_VERSION } from '../../prompts/system-prompt';
import { ToolPolicyService } from '../architecture/tool-policy.service';

@Injectable()
export class DraftContextService {
  private readonly logger = new Logger(DraftContextService.name);

  constructor(
    private readonly operationDraftService: OperationDraftService,
    private readonly toolRegistry: ToolRegistryService,
    @Optional() private readonly toolPolicy?: ToolPolicyService,
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
    const current = await this.operationDraftService
      .getCurrent(conversationId)
      .catch(() => null);
    return (
      this.toolPolicy?.evaluatePlanFirstGuard({
        toolCalls,
        activeDraftType: current?.type ?? null,
      }) ?? new Set<string>()
    );
  }
}
