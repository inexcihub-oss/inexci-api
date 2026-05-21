import { Injectable } from '@nestjs/common';
import {
  PlannerOutput,
  RuntimeState,
} from '../../contracts/agentic-architecture.contracts';

export interface RetrievalDecision {
  shouldQuery: boolean;
  rewrittenQuery: string;
  category?: string;
  reason: string;
}

@Injectable()
export class RetrievalPolicyService {
  decide(input: {
    normalizedInput: string;
    userInput: string;
    planner: PlannerOutput;
    runtimeState: RuntimeState;
  }): RetrievalDecision {
    const normalized = input.normalizedInput.trim();
    if (!normalized) {
      return {
        shouldQuery: false,
        rewrittenQuery: '',
        reason: 'empty_input',
      };
    }
    if (/^(sim|nao|não|ok|1|2|3)$/.test(normalized)) {
      return {
        shouldQuery: false,
        rewrittenQuery: normalized,
        reason: 'control_input',
      };
    }
    if (
      input.runtimeState.pendingConfirmation ||
      input.runtimeState.pendingDocument
    ) {
      return {
        shouldQuery: false,
        rewrittenQuery: normalized,
        reason: 'active_runtime_resolution',
      };
    }

    const category =
      input.planner.retrievalCategory || this.inferCategory(normalized);
    const shouldQuery =
      input.planner.needsRetrieval ||
      normalized.length >= 20 ||
      category === 'faq' ||
      category === 'workflow';

    const rewrittenQuery =
      input.runtimeState.activeWorkflow !== 'idle'
        ? `${input.runtimeState.activeWorkflow}: ${input.userInput}`
        : input.userInput;

    return {
      shouldQuery,
      rewrittenQuery,
      category,
      reason: shouldQuery ? 'planner_or_length' : 'query_not_needed',
    };
  }

  private inferCategory(text: string): string | undefined {
    if (/(como|duvida|ajuda|tutorial|orienta)/.test(text)) return 'faq';
    if (/(status|pendencia|fluxo|etapa|autoriza|agendar)/.test(text)) {
      return 'workflow';
    }
    return undefined;
  }
}
