import { Injectable } from '@nestjs/common';
import { OpenaiService } from '../services/openai.service';
import {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
} from './contracts';
import { ModelTierConfigService } from './model-tier.config';

/**
 * Façade que substitui chamadas diretas ao `OpenaiService.chatCompletion`
 * por uma API tier-based.
 *
 * Estado atual: delega ao `OpenaiService` (que ainda fala Chat Completions
 * com `OpenAI` SDK). Próximas iterações podem rotear para Responses API
 * (gpt-5+) ou outros providers sem mudar chamadores.
 *
 * Decisão de design: o gateway **não** absorve nem reformata o
 * `ChatCompletion` retornado pela OpenAI — devolve em `raw` para preservar
 * compat com `OrchestratorTelemetryService.captureUsageSnapshot`.
 */
@Injectable()
export class ModelGatewayService {
  constructor(
    private readonly tierConfig: ModelTierConfigService,
    private readonly openai: OpenaiService,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const cfg = this.tierConfig.get(request.tier);

    const completion = await this.openai.chatCompletion({
      messages: request.messages,
      tools: cfg.supportsTools ? request.tools : undefined,
      temperature: request.temperature,
      maxTokens: request.maxTokens ?? cfg.maxOutputTokens,
      timeoutMs: request.timeoutMs,
      model: cfg.model,
      responseFormat: cfg.supportsStructuredOutput
        ? request.responseFormat
        : undefined,
      cacheKey: request.cacheKey,
    });

    return {
      raw: completion,
      tier: cfg.tier,
      model: cfg.model,
      apiKind: cfg.apiKind,
    };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const cfg = this.tierConfig.get('embedding');
    const vector = await this.openai.createEmbedding(request.input);
    return { vector, tier: cfg.tier, model: cfg.model };
  }
}
