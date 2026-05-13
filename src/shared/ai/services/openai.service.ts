import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  inexciTracer,
  SpanStatusCode,
} from '../../../shared/observability/tracer';

@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);
  private readonly client: OpenAI;
  private readonly requestTimeoutMs: number;
  private readonly defaultMaxTokens: number;

  constructor(private readonly configService: ConfigService) {
    this.requestTimeoutMs = this.configService.get<number>(
      'OPENAI_REQUEST_TIMEOUT_MS',
      25000,
    );

    const rawMax = this.configService.get<string | number>(
      'AI_RESPONSE_MAX_TOKENS',
      450,
    );
    const parsed = typeof rawMax === 'string' ? parseInt(rawMax, 10) : rawMax;
    this.defaultMaxTokens =
      Number.isFinite(parsed) && parsed > 0 ? parsed : 450;

    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY', ''),
      timeout: this.requestTimeoutMs,
    });
  }

  chatCompletion(params: {
    messages: OpenAI.ChatCompletionMessageParam[];
    tools?: OpenAI.ChatCompletionTool[];
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /** Override do modelo configurado em `OPENAI_MODEL` (ex.: classifier do OCR usa `gpt-4o-mini`). */
    model?: string;
    /**
     * Habilita JSON Schema strict ou JSON mode legacy.
     * Compatível com o param `response_format` do Chat Completions da OpenAI.
     */
    responseFormat?: OpenAI.ChatCompletionCreateParams['response_format'];
    /**
     * Chave de roteamento de prompt caching (ver
     * https://platform.openai.com/docs/guides/prompt-caching). Quando enviada,
     * a OpenAI direciona requests com a mesma chave para a mesma réplica,
     * aumentando o hit rate do cache de prefixo. Use uma chave estável que
     * agrupe prompts com o mesmo prefixo (ex.: `inexci:wa:v2.1.2:draft=create_sc`).
     *
     * O SDK 4.104 ainda não tipa esse campo — propagamos via cast `as any`,
     * já que a API HTTP aceita normalmente.
     */
    cacheKey?: string;
  }): Promise<OpenAI.ChatCompletion> {
    return inexciTracer.startActiveSpan(
      'openai.chatCompletion',
      async (span) => {
        const model =
          params.model ??
          this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
        span.setAttribute('ai.model', model);
        span.setAttribute('ai.tools.count', params.tools?.length ?? 0);
        if (params.cacheKey) span.setAttribute('ai.cache.key', params.cacheKey);
        try {
          const result = await this.chatCompletionWithRetry(params);
          const usage = result.usage;
          if (usage) {
            span.setAttribute('ai.usage.prompt_tokens', usage.prompt_tokens);
            span.setAttribute(
              'ai.usage.completion_tokens',
              usage.completion_tokens,
            );
            span.setAttribute('ai.usage.total_tokens', usage.total_tokens);
            const cached =
              (usage as any).prompt_tokens_details?.cached_tokens ?? 0;
            if (cached) span.setAttribute('ai.usage.cached_tokens', cached);
          }
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          span.recordException(e);
          span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
          throw e;
        } finally {
          span.end();
        }
      },
    );
  }

  private async chatCompletionWithRetry(
    params: {
      messages: OpenAI.ChatCompletionMessageParam[];
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
      timeoutMs?: number;
      model?: string;
      responseFormat?: OpenAI.ChatCompletionCreateParams['response_format'];
      cacheKey?: string;
    },
    retries = 1,
  ): Promise<OpenAI.ChatCompletion> {
    const effectiveTimeoutMs =
      typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
        ? Math.max(1, Math.floor(params.timeoutMs))
        : this.requestTimeoutMs;

    const effectiveModel =
      params.model && params.model.trim().length > 0
        ? params.model.trim()
        : this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');

    const requestBody: OpenAI.ChatCompletionCreateParams = {
      model: effectiveModel,
      messages: params.messages,
      tools: params.tools?.length ? params.tools : undefined,
      tool_choice: params.tools?.length ? 'auto' : undefined,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      response_format: params.responseFormat,
    };

    const trimmedCacheKey = params.cacheKey?.trim();
    if (trimmedCacheKey) {
      // O campo `prompt_cache_key` ainda não está tipado no SDK 4.x, mas a
      // API HTTP da OpenAI aceita desde out/2024. Usar `as any` aqui evita
      // bumpar o SDK só para isso.
      (requestBody as any).prompt_cache_key = trimmedCacheKey;
    }

    try {
      return await this.client.chat.completions.create(requestBody, {
        timeout: effectiveTimeoutMs,
      });
    } catch (error: any) {
      const isRetryable =
        error?.status === 500 ||
        error?.status === 503 ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ECONNABORTED' ||
        error?.name === 'AbortError';

      if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') {
        this.logger.warn(
          `Timeout na chamada OpenAI após ${effectiveTimeoutMs}ms`,
        );
      }

      if (retries > 0 && isRetryable) {
        this.logger.warn(`OpenAI erro ${error?.status}, tentando novamente...`);
        await new Promise((r) => setTimeout(r, 3000));
        return this.chatCompletionWithRetry(params, retries - 1);
      }
      throw error;
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create(
      {
        model: this.configService.get<string>(
          'OPENAI_EMBEDDING_MODEL',
          'text-embedding-3-small',
        ),
        input: text,
      },
      { timeout: this.requestTimeoutMs },
    );
    return response.data[0].embedding;
  }
}
