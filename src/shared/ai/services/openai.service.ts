import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

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
  }): Promise<OpenAI.ChatCompletion> {
    return this.chatCompletionWithRetry(params);
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

    try {
      return await this.client.chat.completions.create(
        {
          model: effectiveModel,
          messages: params.messages,
          tools: params.tools?.length ? params.tools : undefined,
          tool_choice: params.tools?.length ? 'auto' : undefined,
          temperature: params.temperature ?? 0.3,
          max_tokens: params.maxTokens ?? this.defaultMaxTokens,
          response_format: params.responseFormat,
        },
        { timeout: effectiveTimeoutMs },
      );
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
