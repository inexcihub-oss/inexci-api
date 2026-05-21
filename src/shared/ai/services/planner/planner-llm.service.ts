import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ModelGatewayService } from '../model-gateway.service';

const PLANNER_RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'PlannerResponse',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intent: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        nextBestAction: { type: 'string' },
        needsRetrieval: { type: 'boolean' },
        retrievalCategory: {
          type: ['string', 'null'],
        },
      },
      required: [
        'intent',
        'confidence',
        'nextBestAction',
        'needsRetrieval',
        'retrievalCategory',
      ],
    },
  },
} as const satisfies OpenAI.ChatCompletionCreateParams['response_format'];

export interface PlannerLlmResult {
  intent: string;
  confidence: number;
  nextBestAction: string;
  needsRetrieval: boolean;
  retrievalCategory: string | null;
}

@Injectable()
export class PlannerLlmService {
  constructor(private readonly modelGateway: ModelGatewayService) {}

  async classify(input: {
    normalizedInput: string;
  }): Promise<PlannerLlmResult | null> {
    const completion = await this.modelGateway.chatCompletion({
      tier: 'cheap',
      operation: 'planner_llm_classification',
      messages: [
        {
          role: 'system',
          content:
            'Classifique a intenção do usuário de forma curta e estruturada. Use intents como create_sc, scheduling, invoice, contestation, faq, lookup_surgery_request, unknown.',
        },
        {
          role: 'user',
          content: input.normalizedInput,
        },
      ],
      responseFormat: PLANNER_RESPONSE_SCHEMA,
      maxTokens: 250,
      temperature: 0,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) return null;
    try {
      return JSON.parse(content) as PlannerLlmResult;
    } catch {
      return null;
    }
  }
}
