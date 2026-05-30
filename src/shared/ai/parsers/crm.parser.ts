import { ParseResult } from './parser.types';

const CRM_RE = /\bCRM[\s/-]?([A-Z]{2})\s*(\d{4,7})\b/gi;

export function parseCrms(text: string): ParseResult[] {
  const out: ParseResult[] = [];
  if (!text) return out;
  let m: RegExpExecArray | null;
  CRM_RE.lastIndex = 0;
  const seen = new Set<string>();
  while ((m = CRM_RE.exec(text)) !== null) {
    const uf = m[1].toUpperCase();
    const num = m[2];
    const value = `CRM-${uf} ${num}`;
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
