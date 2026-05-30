import { ParserSource } from '../parsers/parser.types';

export type DocumentRecommendation =
  | 'accept'
  | 'cheap_llm'
  | 'vision_fallback'
  | 'ask_user';

export interface FieldExtraction<T = unknown> {
  field: string;
  value: T;
  confidence: number;
  sources: ParserSource[];
  /** Texto cru do match (sem normalização). */
  raw?: string;
}

export interface DocumentExtraction {
  fields: FieldExtraction[];
  /** Média ponderada simples; ver `computeGlobalConfidence`. */
  global_confidence: number;
  recommendation: DocumentRecommendation;
  /** Diagnóstico — quais campos vieram fracos. */
  weak_fields: string[];
}
