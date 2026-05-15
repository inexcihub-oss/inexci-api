import { ConfigService } from '@nestjs/config';
import { ModelTierConfigService } from './model-tier.config';
import { DEFAULT_TIER_CONFIGS } from './model-tier.types';

function makeConfigService(env: Record<string, string>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) =>
      env[key] ?? (defaultValue as string | undefined),
  } as unknown as ConfigService;
}

describe('ModelTierConfigService', () => {
  it('cai para defaults quando AI_TIER_* ausente', () => {
    const svc = new ModelTierConfigService(makeConfigService({}));
    expect(svc.get('cheap').model).toBe(DEFAULT_TIER_CONFIGS.cheap.model);
    expect(svc.get('standard').model).toBe(DEFAULT_TIER_CONFIGS.standard.model);
    expect(svc.get('embedding').model).toBe(
      DEFAULT_TIER_CONFIGS.embedding.model,
    );
  });

  it('parseia provider:model:apiKind', () => {
    const svc = new ModelTierConfigService(
      makeConfigService({
        AI_TIER_CHEAP: 'openai:gpt-4o-mini:chat_completions',
        AI_TIER_STANDARD: 'openai:gpt-4o',
        AI_TIER_EMBEDDING: 'openai:text-embedding-3-small:embeddings',
      }),
    );
    const cheap = svc.get('cheap');
    expect(cheap.provider).toBe('openai');
    expect(cheap.model).toBe('gpt-4o-mini');
    expect(cheap.apiKind).toBe('chat_completions');

    const std = svc.get('standard');
    expect(std.model).toBe('gpt-4o');
    expect(std.apiKind).toBe(DEFAULT_TIER_CONFIGS.standard.apiKind);

    expect(svc.get('embedding').apiKind).toBe('embeddings');
  });

  it('valor inválido cai para default', () => {
    const svc = new ModelTierConfigService(
      makeConfigService({ AI_TIER_CHEAP: 'sem-dois-pontos' }),
    );
    expect(svc.get('cheap').model).toBe(DEFAULT_TIER_CONFIGS.cheap.model);
  });

  it('herda pricing do MODEL_COST_PER_1K quando modelo conhecido', () => {
    const svc = new ModelTierConfigService(
      makeConfigService({ AI_TIER_CHEAP: 'openai:gpt-4o-mini' }),
    );
    expect(svc.get('cheap').costPer1kInput).toBeGreaterThan(0);
  });

  it('all() devolve todos os 5 tiers', () => {
    const svc = new ModelTierConfigService(makeConfigService({}));
    const all = svc.all();
    expect(Object.keys(all).sort()).toEqual(
      ['cheap', 'embedding', 'premium', 'standard', 'vision'].sort(),
    );
  });
});
