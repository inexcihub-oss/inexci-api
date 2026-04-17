import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY', ''),
    });
  }

  async chatCompletion(params: {
    messages: OpenAI.ChatCompletionMessageParam[];
    tools?: OpenAI.ChatCompletionTool[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<OpenAI.ChatCompletion> {
    return this.chatCompletionWithRetry(params);
  }

  private async chatCompletionWithRetry(
    params: {
      messages: OpenAI.ChatCompletionMessageParam[];
      tools?: OpenAI.ChatCompletionTool[];
      temperature?: number;
      maxTokens?: number;
    },
    retries = 1,
  ): Promise<OpenAI.ChatCompletion> {
    try {
      return await this.client.chat.completions.create({
        model: this.configService.get<string>('OPENAI_MODEL', 'gpt-4o'),
        messages: params.messages,
        tools: params.tools?.length ? params.tools : undefined,
        tool_choice: params.tools?.length ? 'auto' : undefined,
        temperature: params.temperature ?? 0.3,
        max_tokens: params.maxTokens ?? 2048,
      });
    } catch (error: any) {
      const isRetryable =
        error?.status === 500 ||
        error?.status === 503 ||
        error?.code === 'ETIMEDOUT';
      if (retries > 0 && isRetryable) {
        this.logger.warn(`OpenAI erro ${error?.status}, tentando novamente...`);
        await new Promise((r) => setTimeout(r, 3000));
        return this.chatCompletionWithRetry(params, retries - 1);
      }
      throw error;
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.configService.get<string>(
        'OPENAI_EMBEDDING_MODEL',
        'text-embedding-3-small',
      ),
      input: text,
    });
    return response.data[0].embedding;
  }
}
