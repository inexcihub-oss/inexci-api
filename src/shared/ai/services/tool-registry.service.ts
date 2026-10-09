import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import { AiTool, AI_TOOL, ToolContext } from '../tools/tool.interface';
import { OperationDraftType } from '../drafts/operation-draft.types';

const DRAFT_PREFIX_TO_TYPE: Record<string, OperationDraftType> = {
  sc: 'create_sc',
  patient: 'create_patient',
  hospital: 'create_hospital',
  health_plan: 'create_health_plan',
  procedure: 'create_procedure',
  invoice: 'invoice',
  contestation: 'contestation',
  scheduling: 'scheduling',
  update_sc: 'update_sc',
  send_sc: 'send_sc',
  start_analysis: 'start_analysis',
  accept_authorization: 'accept_authorization',
  mark_performed: 'mark_performed',
};

export function detectDraftType(toolName: string): OperationDraftType | null {
  const idx = toolName.indexOf('_draft_');
  if (idx === -1) return null;
  const prefix = toolName.slice(0, idx);
  return DRAFT_PREFIX_TO_TYPE[prefix] ?? null;
}

const NO_DRAFT_CACHE_KEY = 'none';

const GLOBAL_DRAFT_TOOL_NAMES = new Set([
  'draft_update',
  'draft_status',
  'draft_cancel',
]);

const ALL_CACHE_KEYS: readonly string[] = [
  NO_DRAFT_CACHE_KEY,
  ...new Set(Object.values(DRAFT_PREFIX_TO_TYPE)),
];

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);

  private readonly tools = new Map<string, AiTool>();

  private readonly definitionsCache = new Map<
    string,
    OpenAI.ChatCompletionTool[]
  >();

  constructor(@Inject(AI_TOOL) allTools: AiTool[]) {
    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  onModuleInit(): void {
    for (const key of ALL_CACHE_KEYS) {
      const draftType =
        key === NO_DRAFT_CACHE_KEY ? null : (key as OperationDraftType);
      this.definitionsCache.set(
        key,
        this.computeDefinitionsForDraft(draftType),
      );
    }
    this.logger.log(
      `[TOOL_REGISTRY_WARMUP] cached_keys=${ALL_CACHE_KEYS.length} total_tools=${this.tools.size}`,
    );
  }

  getToolDefinitions(): OpenAI.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getToolDefinitionsForDraft(
    activeDraftType: OperationDraftType | null,
  ): OpenAI.ChatCompletionTool[] {
    const key = activeDraftType ?? NO_DRAFT_CACHE_KEY;
    const cached = this.definitionsCache.get(key);
    if (cached) return cached;
    const computed = this.computeDefinitionsForDraft(activeDraftType);
    this.definitionsCache.set(key, computed);
    return computed;
  }

  private computeDefinitionsForDraft(
    activeDraftType: OperationDraftType | null,
  ): OpenAI.ChatCompletionTool[] {
    const result: OpenAI.ChatCompletionTool[] = [];
    for (const tool of this.tools.values()) {
      const name = tool.name;

      if (GLOBAL_DRAFT_TOOL_NAMES.has(name)) {
        if (activeDraftType !== null) {
          result.push(tool.definition);
        }
        continue;
      }

      const draftType = detectDraftType(name);

      if (draftType === null) {
        result.push(tool.definition);
        continue;
      }

      if (activeDraftType && draftType === activeDraftType) {
        result.push(tool.definition);
      }
    }
    return result;
  }

  getTool(name: string): AiTool | undefined {
    return this.tools.get(name);
  }

  executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return Promise.resolve(`Ferramenta "${name}" não encontrada.`);
    return tool.execute(args, context);
  }
}
