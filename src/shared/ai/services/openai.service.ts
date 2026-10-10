import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { errorMessage } from '../../utils/error-message.util';
import {
  inexciTracer,
  SpanStatusCode,
} from '../../../shared/observability/tracer';
import {
  recordOpenaiRequestDuration,
  recordOpenaiTokens,
} from '../../../shared/observability/metrics.util';

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
      maxRetries: 0,
    });
  }

  chatCompletion(params: {
    messages: OpenAI.ChatCompletionMessageParam[];
    tools?: OpenAI.ChatCompletionTool[];
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    model?: string;
    responseFormat?: OpenAI.ChatCompletionCreateParams['response_format'];
    cacheKey?: string;
    stage?: 'chat' | 'summary' | 'doc_classifier' | 'doc_vision_fallback';
  }): Promise<OpenAI.ChatCompletion> {
    return inexciTracer.startActiveSpan(
      'openai.chatCompletion',
      async (span) => {
        const model =
          params.model ??
          this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
        const stage = params.stage ?? 'chat';
        span.setAttribute('ai.model', model);
        span.setAttribute('ai.tools.count', params.tools?.length ?? 0);
        if (params.cacheKey) span.setAttribute('ai.cache.key', params.cacheKey);
        const startedAt = Date.now();
        try {
          const result = await this.chatCompletionWithRetry(params);
          recordOpenaiRequestDuration(Date.now() - startedAt, {
            model,
            stage,
          });
          const usage = result.usage;
          if (usage) {
            span.setAttribute('ai.usage.prompt_tokens', usage.prompt_tokens);
            span.setAttribute(
              'ai.usage.completion_tokens',
              usage.completion_tokens,
            );
            span.setAttribute('ai.usage.total_tokens', usage.total_tokens);
            recordOpenaiTokens(usage.prompt_tokens, {
              model,
              stage,
              type: 'prompt',
            });
            recordOpenaiTokens(usage.completion_tokens, {
              model,
              stage,
              type: 'completion',
            });
            const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
            if (cached) span.setAttribute('ai.usage.cached_tokens', cached);
          }
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e) {
          recordOpenaiRequestDuration(Date.now() - startedAt, {
            model,
            stage,
          });
          span.recordException(e instanceof Error ? e : String(e));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: errorMessage(e),
          });
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

    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;
    const isNewGenModel = /^(o\d|gpt-5)/.test(effectiveModel);

    const requestBody: OpenAI.ChatCompletionCreateParams & {
      prompt_cache_key?: string;
    } = {
      model: effectiveModel,
      messages: params.messages,
      tools: params.tools?.length ? params.tools : undefined,
      tool_choice: params.tools?.length ? 'auto' : undefined,
      ...(!isNewGenModel && { temperature: params.temperature ?? 0.3 }),
      ...(isNewGenModel
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      response_format: params.responseFormat,
    };

    const trimmedCacheKey = params.cacheKey?.trim();
    if (trimmedCacheKey) {
      requestBody.prompt_cache_key = trimmedCacheKey;
    }

    try {
      return await this.client.chat.completions.create(requestBody, {
        timeout: effectiveTimeoutMs,
      });
    } catch (error) {
      const { status, code, name } = (
        typeof error === 'object' && error !== null ? error : {}
      ) as { status?: unknown; code?: unknown; name?: unknown };
      const isRetryable =
        status === 500 ||
        status === 503 ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        name === 'AbortError';

      if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
        this.logger.warn(
          `Timeout na chamada OpenAI após ${effectiveTimeoutMs}ms`,
        );
      }

      if (retries > 0 && isRetryable) {
        this.logger.warn(
          `OpenAI erro ${String(status)}, tentando novamente...`,
        );
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
