export type ParserSourceKind =
  | 'regex'
  | 'checksum'
  | 'fuzzy'
  | 'cross_ref'
  | 'llm'
  | 'vision';

export interface ParserSource {
  kind: ParserSourceKind;
  score: number;
}

export interface ParseResult<T = string> {
  value: T;
  /** 0..1 — combinação ponderada das `sources`. */
  confidence: number;
  sources: ParserSource[];
  /** Texto original extraído (antes da normalização). */
  raw: string;
}
