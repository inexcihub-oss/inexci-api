import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODEL_COST_PER_1K } from '../constants/ai.constants';
import {
  ALL_TIERS,
  DEFAULT_TIER_CONFIGS,
  ModelApiKind,
  ModelProvider,
  ModelTier,
  ModelTierConfig,
} from './model-tier.types';

/**
 * Resolve `ModelTierConfig` a partir das envs `AI_TIER_*`.
 *
 * Formato aceito:
 *   `<provider>:<model>` ou `<provider>:<model>:<apiKind>`
 *
 * Exemplos:
 *   AI_TIER_CHEAP=openai:gpt-4o-mini
 *   AI_TIER_STANDARD=openai:gpt-5-mini:chat_completions
 *   AI_TIER_EMBEDDING=openai:text-embedding-3-small:embeddings
 *
 * Quando a env é inválida ou ausente, o tier cai para o default em
 * `DEFAULT_TIER_CONFIGS` — garantindo que o boot do app não falhe e
 * permitindo rollout gradual (por env, sem deploy).
 */
@Injectable()
export class ModelTierConfigService {
  private readonly logger = new Logger(ModelTierConfigService.name);
  private readonly resolved: Record<ModelTier, ModelTierConfig>;

  constructor(private readonly configService: ConfigService) {
    this.resolved = {} as Record<ModelTier, ModelTierConfig>;
    for (const tier of ALL_TIERS) {
      this.resolved[tier] = this.resolveTier(tier);
    }
    this.logger.log(
      `[MODEL_GATEWAY_BOOT] ${ALL_TIERS
        .map((t) => `${t}=${this.resolved[t].provider}:${this.resolved[t].model}`)
        .join(' ')}`,
    );
  }

  get(tier: ModelTier): ModelTierConfig {
    return this.resolved[tier];
  }

  all(): Record<ModelTier, ModelTierConfig> {
    return { ...this.resolved };
  }

  private resolveTier(tier: ModelTier): ModelTierConfig {
    const envKey = `AI_TIER_${tier.toUpperCase()}`;
    const raw = this.configService.get<string>(envKey);
    const fallback = DEFAULT_TIER_CONFIGS[tier];

    if (!raw || raw.trim().length === 0) {
      return fallback;
    }

    const parts = raw.trim().split(':');
    if (parts.length < 2) {
      this.logger.warn(
        `[MODEL_GATEWAY] env ${envKey}="${raw}" inválida (esperado provider:model[:apiKind]); usando default ${fallback.model}`,
      );
      return fallback;
    }

    const provider = parts[0] as ModelProvider;
    const model = parts[1];
    const apiKind = (parts[2] as ModelApiKind) ?? fallback.apiKind;

    if (!model) {
      this.logger.warn(
        `[MODEL_GATEWAY] env ${envKey} sem nome de modelo; usando default`,
      );
      return fallback;
    }

    const pricing = MODEL_COST_PER_1K[model];

    return {
      tier,
      provider,
      model,
      apiKind,
      maxOutputTokens: fallback.maxOutputTokens,
      costPer1kInput: pricing?.input ?? fallback.costPer1kInput,
      costPer1kOutput: pricing?.output ?? fallback.costPer1kOutput,
      supportsTools: fallback.supportsTools,
      supportsStructuredOutput: fallback.supportsStructuredOutput,
    };
  }
}
