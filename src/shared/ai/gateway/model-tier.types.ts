/**
 * Tipos do Model Gateway (Fase 1 do Blueprint v3).
 *
 * O gateway resolve cada chamada de IA por **tier** lógico, desacoplando
 * o resto do sistema do provider/modelo concreto. Trocar `gpt-4o` por
 * `gpt-5-mini`, ou OpenAI por Azure, não exige mexer em chamadores.
 *
 * Convenção de envs (parser em `model-tier.config.ts`):
 *   AI_TIER_CHEAP=openai:gpt-4o-mini:chat_completions
 *   AI_TIER_STANDARD=openai:gpt-4o:chat_completions
 *   AI_TIER_PREMIUM=openai:gpt-4o:chat_completions
 *   AI_TIER_VISION=openai:gpt-4o:chat_completions
 *   AI_TIER_EMBEDDING=openai:text-embedding-3-small:embeddings
 *
 * O sufixo `:apiKind` é tolerado no parser e tem default por tier.
 */

import { MODEL_COST_PER_1K } from '../constants/ai.constants';

export type ModelTier =
  | 'cheap'
  | 'standard'
  | 'premium'
  | 'vision'
  | 'embedding';

export type ModelProvider = 'openai' | 'anthropic' | 'azure' | 'local';

export type ModelApiKind =
  | 'chat_completions'
  | 'responses'
  | 'embeddings'
  | 'audio';

export interface ModelTierConfig {
  tier: ModelTier;
  provider: ModelProvider;
  model: string;
  apiKind: ModelApiKind;
  /** Default `max_completion_tokens` ou `max_tokens` para chamadas chat. */
  maxOutputTokens: number;
  /** Custos em centavos de USD por 1K tokens. */
  costPer1kInput: number;
  costPer1kOutput: number;
  /** Habilita envio de `tools` na chamada. */
  supportsTools: boolean;
  /** Habilita envio de `response_format` (json_schema strict). */
  supportsStructuredOutput: boolean;
}

/**
 * Default cobre o estado **atual** do código antes da migração para
 * gpt-5-mini/nano: cheap = `gpt-4o-mini`, standard/premium/vision =
 * `gpt-4o`, embedding = `text-embedding-3-small`. Sobreponíveis por
 * env (`AI_TIER_*`).
 */
export const DEFAULT_TIER_CONFIGS: Record<ModelTier, ModelTierConfig> = {
  cheap: {
    tier: 'cheap',
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKind: 'chat_completions',
    maxOutputTokens: 1024,
    costPer1kInput: MODEL_COST_PER_1K['gpt-4o-mini'].input,
    costPer1kOutput: MODEL_COST_PER_1K['gpt-4o-mini'].output,
    supportsTools: true,
    supportsStructuredOutput: true,
  },
  standard: {
    tier: 'standard',
    provider: 'openai',
    model: 'gpt-4o',
    apiKind: 'chat_completions',
    maxOutputTokens: 1024,
    costPer1kInput: MODEL_COST_PER_1K['gpt-4o'].input,
    costPer1kOutput: MODEL_COST_PER_1K['gpt-4o'].output,
    supportsTools: true,
    supportsStructuredOutput: true,
  },
  premium: {
    tier: 'premium',
    provider: 'openai',
    model: 'gpt-4o',
    apiKind: 'chat_completions',
    maxOutputTokens: 2048,
    costPer1kInput: MODEL_COST_PER_1K['gpt-4o'].input,
    costPer1kOutput: MODEL_COST_PER_1K['gpt-4o'].output,
    supportsTools: true,
    supportsStructuredOutput: true,
  },
  vision: {
    tier: 'vision',
    provider: 'openai',
    model: 'gpt-4o',
    apiKind: 'chat_completions',
    maxOutputTokens: 2500,
    costPer1kInput: MODEL_COST_PER_1K['gpt-4o'].input,
    costPer1kOutput: MODEL_COST_PER_1K['gpt-4o'].output,
    supportsTools: false,
    supportsStructuredOutput: true,
  },
  embedding: {
    tier: 'embedding',
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKind: 'embeddings',
    maxOutputTokens: 0,
    costPer1kInput: 0.002,
    costPer1kOutput: 0,
    supportsTools: false,
    supportsStructuredOutput: false,
  },
};

export const ALL_TIERS: readonly ModelTier[] = [
  'cheap',
  'standard',
  'premium',
  'vision',
  'embedding',
];
