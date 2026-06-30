import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { OperationDraftService } from '../operation-draft.service';
import { ToolRegistryService } from '../tool-registry.service';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { PROMPT_VERSION } from '../../prompts/system-prompt';

@Injectable()
export class DraftContextService {
  private readonly logger = new Logger(DraftContextService.name);

  constructor(
    private readonly operationDraftService: OperationDraftService,
    private readonly toolRegistry: ToolRegistryService,
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
}
