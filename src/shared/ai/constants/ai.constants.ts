export const MAX_RESPONSE_LENGTH = 1000;

export const WHATSAPP_TARGET_LENGTH = 850;

export const PII_VAULT_PERSIST_TTL_SECONDS = 60 * 60;

export const MODEL_COST_PER_1K: Record<
  string,
  { input: number; output: number }
> = {
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-2024-08-06': { input: 0.25, output: 1.0 },
  'gpt-4o-2024-11-20': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-4o-mini-2024-07-18': { input: 0.015, output: 0.06 },
  'gpt-4-turbo': { input: 1.0, output: 3.0 },
  'gpt-3.5-turbo': { input: 0.05, output: 0.15 },
};
