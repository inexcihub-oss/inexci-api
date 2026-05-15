import { ParseResult } from './parser.types';

const TUSS_RE = /\b\d{8}\b/g;

/**
 * Extrai códigos TUSS (8 dígitos). Quando `crossRefValid(code)` confirma
 * presença em `tuss.json`, eleva confidence para 1.0.
 */
export function parseTussCodes(
  text: string,
  crossRefValid?: (code: string) => boolean,
): ParseResult[] {
  const out: ParseResult[] = [];
  if (!text) return out;
  let m: RegExpExecArray | null;
  TUSS_RE.lastIndex = 0;
  const seen = new Set<string>();
  while ((m = TUSS_RE.exec(text)) !== null) {
    const code = m[0];
    if (seen.has(code)) continue;
    seen.add(code);
    const validInCatalog = crossRefValid ? crossRefValid(code) : false;
    out.push({
      value: code,
      raw: code,
      confidence: validInCatalog ? 1.0 : 0.55,
      sources: [
        { kind: 'regex', score: 0.55 },
        ...(crossRefValid
          ? [{ kind: 'cross_ref' as const, score: validInCatalog ? 0.45 : 0 }]
          : []),
      ],
    });
  }
  return out;
}
