import { MODEL_COST_PER_1K } from '../constants/ai.constants';

export interface AiUsageCostInput {
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
}

export function estimateCostCents(items: AiUsageCostInput[]): number | null {
  let total = 0;
  let hasPricing = false;
  for (const item of items) {
    const pricing = item.model ? MODEL_COST_PER_1K[item.model] : undefined;
    if (!pricing) continue;
    hasPricing = true;
    total +=
      (item.promptTokens / 1000) * pricing.input +
      (item.completionTokens / 1000) * pricing.output;
  }
  return hasPricing ? Math.round(total) : null;
}
