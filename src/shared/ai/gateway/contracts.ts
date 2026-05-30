import OpenAI from 'openai';
import { ModelApiKind, ModelTier } from './model-tier.types';

/**
 * Contrato genérico de uma chamada ao Model Gateway. Mantém compat
 * intencional com `OpenaiService.chatCompletion` para facilitar a
 * migração — porém, em vez de aceitar `model` cru, exige `tier`.
 */
export interface CompletionRequest {
  /** Tier lógico — gateway resolve provider/model concretos. */
  tier: ModelTier;
  messages: OpenAI.ChatCompletionMessageParam[];
  tools?: OpenAI.ChatCompletionTool[];
  /** Override por chamada (ex.: 0 para extração determinística). */
  temperature?: number;
  /** Override; quando ausente, usa `tierConfig.maxOutputTokens`. */
  maxTokens?: number;
  /** Timeout efetivo da chamada. */
  timeoutMs?: number;
  /** JSON-Schema strict ou JSON mode legacy. */
  responseFormat?: OpenAI.ChatCompletionCreateParams['response_format'];
  /**
   * `prompt_cache_key` da OpenAI — agrupa requests pelo mesmo prefixo
   * estável para maximizar hit-rate do prompt caching da OpenAI.
   */
  cacheKey?: string;
}

/**
 * Resposta normalizada do gateway. Hoje devolve a `ChatCompletion` da
 * OpenAI tal qual, mas inclui metadados resolvidos (tier, model,
 * apiKind) para telemetria.
 */
export interface CompletionResponse {
  raw: OpenAI.ChatCompletion;
  tier: ModelTier;
  model: string;
  apiKind: ModelApiKind;
}

export interface EmbeddingRequest {
  tier?: 'embedding';
  input: string;
  timeoutMs?: number;
}

export interface EmbeddingResponse {
  vector: number[];
  tier: ModelTier;
  model: string;
}
