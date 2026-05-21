import { Injectable } from '@nestjs/common';

export interface DeterministicIntentResult {
  intent: string;
  confidence: number;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
}

@Injectable()
export class DeterministicIntentClassifierService {
  classify(input: string): DeterministicIntentResult | null {
    const text = input.trim().toLowerCase();
    if (!text) return null;

    const rules: Array<{
      intent: string;
      patterns: RegExp[];
      confidence: number;
    }> = [
      {
        intent: 'create_sc',
        patterns: [/\b(criar|nova|abrir).*(sc|solicita)/, /\bcriar sc\b/],
        confidence: 0.9,
      },
      {
        intent: 'scheduling',
        patterns: [/\bagend/, /\breagend/],
        confidence: 0.86,
      },
      {
        intent: 'invoice',
        patterns: [/\bfatur/, /\bfatura\b/, /\binvoice\b/],
        confidence: 0.86,
      },
      {
        intent: 'contestation',
        patterns: [/\bcontest/],
        confidence: 0.82,
      },
      {
        intent: 'faq',
        patterns: [/\bcomo\b/, /\bajuda\b/, /\bd[uú]vida\b/],
        confidence: 0.72,
      },
      {
        intent: 'lookup_surgery_request',
        patterns: [
          /\bstatus\b/,
          /\bpend[eê]ncia\b/,
          /\bminhas sc\b/,
          /\bprotocolo\b/,
        ],
        confidence: 0.74,
      },
    ];

    for (const rule of rules) {
      if (rule.patterns.some((pattern) => pattern.test(text))) {
        return {
          intent: rule.intent,
          confidence: rule.confidence,
          entities: this.extractEntities(text),
        };
      }
    }

    return null;
  }

  private extractEntities(text: string): DeterministicIntentResult['entities'] {
    const entities: DeterministicIntentResult['entities'] = [];
    for (const match of text.matchAll(/\bsc-\d+\b/g)) {
      entities.push({
        type: 'surgery_request_protocol',
        value: match[0],
        confidence: 0.96,
      });
    }
    for (const match of text.matchAll(/\b[A-Z]\d{2}(?:\.\d)?\b/gi)) {
      entities.push({
        type: 'cid',
        value: match[0].toUpperCase(),
        confidence: 0.85,
      });
    }
    for (const match of text.matchAll(/\b\d{8,9}\b/g)) {
      entities.push({
        type: 'tuss',
        value: match[0],
        confidence: 0.75,
      });
    }
    return entities.slice(0, 12);
  }
}
