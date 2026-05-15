import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { OperationDraftType } from '../../drafts/operation-draft.types';

const COMPLEX_MUTATION_TOOL_NAMES = new Set([
  'draft_update',
  'sc_draft_preview',
  'sc_draft_commit',
  'patient_draft_preview',
  'patient_draft_commit',
  'hospital_draft_preview',
  'hospital_draft_commit',
  'health_plan_draft_preview',
  'health_plan_draft_commit',
  'procedure_draft_preview',
  'procedure_draft_commit',
  'invoice_draft_preview',
  'invoice_draft_commit',
  'contestation_draft_preview',
  'contestation_draft_commit',
  'scheduling_draft_preview',
  'scheduling_draft_commit',
  'update_sc_draft_preview',
  'update_sc_draft_commit',
  'send_sc_draft_preview',
  'send_sc_draft_commit',
  'start_analysis_draft_preview',
  'start_analysis_draft_commit',
  'accept_authorization_draft_preview',
  'accept_authorization_draft_commit',
  'mark_performed_draft_preview',
  'mark_performed_draft_commit',
]);

@Injectable()
export class ToolPolicyService {
  evaluatePlanFirstGuard(input: {
    toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined;
    activeDraftType: OperationDraftType | null;
  }): Set<string> {
    const blocked = new Set<string>();
    const toolCalls = input.toolCalls || [];
    if (!toolCalls.length || input.activeDraftType) return blocked;

    const hasPlanActions = toolCalls.some(
      (call) => call.function?.name === 'plan_actions',
    );
    if (hasPlanActions) return blocked;

    for (const call of toolCalls) {
      const toolName = call.function?.name || '';
      if (COMPLEX_MUTATION_TOOL_NAMES.has(toolName)) {
        blocked.add(call.id);
      }
    }

    return blocked;
  }

  rankTools(toolNames: string[], intent: string): string[] {
    const prioritized = [...toolNames];
    prioritized.sort((left, right) => {
      const leftScore = this.scoreTool(left, intent);
      const rightScore = this.scoreTool(right, intent);
      return rightScore - leftScore;
    });
    return prioritized;
  }

  private scoreTool(toolName: string, intent: string): number {
    if (toolName === 'plan_actions') return intent === 'unknown' ? 100 : 70;
    if (intent && toolName.includes(intent)) return 90;
    if (toolName === 'draft_update') return 80;
    if (toolName.startsWith('query_') || toolName.startsWith('search_'))
      return 60;
    return 10;
  }
}
