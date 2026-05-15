import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import {
  AiTool,
  AiToolCategory,
  AiToolSpec,
  DEFAULT_TOOL_SPEC,
} from '../../tools/tool.interface';

export interface ToolSubsetSelectionInput {
  tools: AiTool[];
  intent: string;
  activeDraftType: string | null;
  requiresConfirmation: boolean;
}

@Injectable()
export class ToolSubsetSelectorService {
  select(input: ToolSubsetSelectionInput): OpenAI.ChatCompletionTool[] {
    const allowedCategories = this.allowedCategoriesForIntent(input.intent);

    return input.tools
      .filter((tool) => {
        const spec = this.normalizeSpec(tool.spec);
        const inferredSpec = this.inferCategoryFromName(tool.name, spec);
        if (!allowedCategories.has(inferredSpec.category)) return false;
        if (
          input.activeDraftType &&
          inferredSpec.draftAffinity &&
          inferredSpec.draftAffinity !== input.activeDraftType
        ) {
          return false;
        }
        if (
          input.requiresConfirmation &&
          inferredSpec.category === 'mutation'
        ) {
          return inferredSpec.requiresConfirmation === true;
        }
        return true;
      })
      .sort((left, right) => {
        const leftScore = this.scoreTool(
          this.inferCategoryFromName(left.name, this.normalizeSpec(left.spec)),
          input.intent,
        );
        const rightScore = this.scoreTool(
          this.inferCategoryFromName(
            right.name,
            this.normalizeSpec(right.spec),
          ),
          input.intent,
        );
        return rightScore - leftScore;
      })
      .slice(0, 15)
      .map((tool) => tool.definition);
  }

  private allowedCategoriesForIntent(intent: string): Set<AiToolCategory> {
    switch (intent) {
      case 'faq':
        return new Set(['query', 'utility']);
      case 'lookup_surgery_request':
        return new Set(['query', 'utility']);
      case 'create_sc':
      case 'scheduling':
      case 'invoice':
      case 'contestation':
        return new Set(['planning', 'draft', 'mutation', 'query', 'utility']);
      default:
        return new Set(['planning', 'query', 'utility']);
    }
  }

  private scoreTool(spec: AiToolSpec, intent: string): number {
    let score = 0;
    if (spec.category === 'planning') score += 50;
    if (spec.category === 'draft') score += 40;
    if (spec.category === 'query') score += 30;
    if (intent === 'faq' && spec.category === 'mutation') score -= 50;
    if (spec.estimatedCost === 'free') score += 10;
    if (spec.estimatedCost === 'expensive') score -= 10;
    if (spec.requiresConfirmation) score -= 2;
    return score;
  }

  private normalizeSpec(spec?: Partial<AiToolSpec>): AiToolSpec {
    const next = {
      ...DEFAULT_TOOL_SPEC,
      ...spec,
    };
    if (!spec?.category) {
      if (spec?.draftAffinity) next.category = 'draft';
    }
    return next;
  }

  private inferCategoryFromName(name: string, spec: AiToolSpec): AiToolSpec {
    const normalized = name.toLowerCase();
    if (normalized === 'plan_actions') {
      return { ...spec, category: 'planning', estimatedCost: 'cheap' };
    }
    if (normalized.includes('_draft_') || normalized.startsWith('draft_')) {
      return { ...spec, category: 'draft' };
    }
    if (
      normalized.startsWith('get_') ||
      normalized.startsWith('list_') ||
      normalized.startsWith('search_') ||
      normalized.includes('status')
    ) {
      return { ...spec, category: 'query', determinismLevel: 'pure' };
    }
    if (normalized.startsWith('send_') || normalized.startsWith('upload_')) {
      return { ...spec, category: 'utility' };
    }
    return spec;
  }
}
