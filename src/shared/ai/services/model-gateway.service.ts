import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';

export type ModelTier =
  | 'cheap'
  | 'standard'
  | 'premium'
  | 'vision'
  | 'embedding';

export interface ModelGatewayCompletionOptions {
  tier: ModelTier;
  operation: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  tools?: OpenAI.ChatCompletionTool[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: OpenAI.ChatCompletionCreateParams['response_format'];
  cacheKey?: string;
}

@Injectable()
export class ModelGatewayService {
  constructor(
    private readonly openai: OpenaiService,
    private readonly configService: ConfigService,
  ) {}

  async chatCompletion(
    options: ModelGatewayCompletionOptions,
  ): Promise<OpenAI.ChatCompletion> {
    return this.openai.chatCompletion({
      model: this.resolveModelForTier(options.tier),
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens:
        options.maxTokens ?? this.resolveMaxTokensForTier(options.tier),
      timeoutMs: options.timeoutMs,
      responseFormat: options.responseFormat,
      cacheKey: options.cacheKey,
    });
  }

  async createEmbedding(text: string): Promise<number[]> {
    return this.openai.createEmbedding(text);
  }

  resolveModelForTier(tier: ModelTier): string {
    const map: Record<ModelTier, string> = {
      cheap: this.configService.get<string>(
        'AI_TIER_CHEAP',
        this.configService.get<string>(
          'OPENAI_PREPROCESSING_MODEL',
          'gpt-5-nano',
        ),
      ),
      standard: this.configService.get<string>(
        'AI_TIER_STANDARD',
        this.configService.get<string>(
          'OPENAI_ORCHESTRATION_MODEL',
          this.configService.get<string>('OPENAI_MODEL', 'gpt-5-mini'),
        ),
      ),
      premium: this.configService.get<string>(
        'AI_TIER_PREMIUM',
        this.configService.get<string>('OPENAI_MODEL', 'gpt-5-mini'),
      ),
      vision: this.configService.get<string>(
        'AI_TIER_VISION',
        this.configService.get<string>(
          'AI_DOC_VISION_FALLBACK_MODEL',
          'gpt-4.1',
        ),
      ),
      embedding: this.configService.get<string>(
        'AI_TIER_EMBEDDING',
        this.configService.get<string>(
          'OPENAI_EMBEDDING_MODEL',
          'text-embedding-3-small',
        ),
      ),
    };

    return map[tier];
  }

  resolveMaxTokensForTier(tier: ModelTier): number {
    const envMap: Record<ModelTier, string> = {
      cheap: 'AI_TIER_CHEAP_MAX_TOKENS',
      standard: 'AI_TIER_STANDARD_MAX_TOKENS',
      premium: 'AI_TIER_PREMIUM_MAX_TOKENS',
      vision: 'AI_TIER_VISION_MAX_TOKENS',
      embedding: 'AI_TIER_EMBEDDING_MAX_TOKENS',
    };
    const defaults: Record<ModelTier, number> = {
      cheap: 500,
      standard: 700,
      premium: 1200,
      vision: 2500,
      embedding: 1,
    };
    return this.configService.get<number>(envMap[tier], defaults[tier]);
  }
}
