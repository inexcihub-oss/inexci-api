import { ParseResult } from './parser.types';

const BRL_RE = /\bR\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)\b/g;
const PT_REAIS_RE = /\b(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)\s*reais\b/gi;

function parseBrlNumber(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

export function parseMoney(text: string): ParseResult<number>[] {
  const out: ParseResult<number>[] = [];
  if (!text) return out;
  const seen = new Set<number>();

  BRL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRL_RE.exec(text)) !== null) {
    const value = parseBrlNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      raw: m[0],
      confidence: 0.95,
      sources: [{ kind: 'regex', score: 0.95 }],
    });
  }

  PT_REAIS_RE.lastIndex = 0;
  while ((m = PT_REAIS_RE.exec(text)) !== null) {
    const value = parseBrlNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      raw: m[0],
      confidence: 0.85,
      sources: [{ kind: 'regex', score: 0.85 }],
    });
  }
  return out;
}
