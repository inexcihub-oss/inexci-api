import { Injectable } from '@nestjs/common';
import { ConversationMemory } from '../../../../database/entities/whatsapp-conversation.entity';
import {
  PersistentMemorySnapshot,
  ShortTermContextSnapshot,
} from '../../contracts/agentic-architecture.contracts';

@Injectable()
export class MemoryProjectionService {
  buildPersistentMemory(
    memory: ConversationMemory | null | undefined,
    userRole?: string | null,
  ): PersistentMemorySnapshot {
    const filled = (memory?.filled_slots as Record<string, unknown>) || {};
    return {
      version: '1.0',
      userRole: userRole ?? null,
      preferredWorkflows: this.compactStrings([
        typeof memory?.intent === 'string' ? memory.intent : null,
      ]),
      recurringEntities: {
        patients: this.collectLabels(filled, ['patient', 'patientLabel']),
        hospitals: this.collectLabels(filled, ['hospital', 'hospitalLabel']),
        healthPlans: this.collectLabels(filled, [
          'healthPlan',
          'healthPlanLabel',
        ]),
        procedures: this.collectLabels(filled, ['procedure', 'procedureLabel']),
      },
      recurrentGoals: this.compactStrings([
        typeof memory?.last_user_goal === 'string'
          ? memory.last_user_goal
          : null,
      ]),
      durableFacts: [
        ...this.compactStrings(memory?.confirmed_facts as string[] | undefined),
        ...this.compactStrings(memory?.pending_actions as string[] | undefined),
      ].slice(0, 8),
    };
  }

  buildShortTermContext(
    memory: ConversationMemory | null | undefined,
  ): ShortTermContextSnapshot {
    return {
      version: '1.0',
      activeTopic: typeof memory?.intent === 'string' ? memory.intent : null,
      pendingAction:
        typeof memory?.last_user_goal === 'string'
          ? memory.last_user_goal
          : null,
      latestUserGoal:
        typeof memory?.last_user_goal === 'string'
          ? memory.last_user_goal
          : null,
      relevantEvents: [
        ...this.compactStrings(memory?.open_questions as string[] | undefined),
        ...this.compactStrings(memory?.pending_actions as string[] | undefined),
      ].slice(0, 6),
    };
  }

  private collectLabels(
    filled: Record<string, unknown>,
    keys: string[],
  ): Array<{ id?: string; label: string }> {
    return keys
      .map((key) => filled[key])
      .flatMap((value) =>
        typeof value === 'string' && value.trim()
          ? [{ label: value.trim() }]
          : [],
      )
      .slice(0, 3);
  }

  private compactStrings(
    values: Array<string | null | undefined> | undefined,
  ): string[] {
    return (values || []).filter(
      (value): value is string => typeof value === 'string' && !!value.trim(),
    );
  }
}
