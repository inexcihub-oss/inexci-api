import { ParseResult } from './parser.types';

const CID_RE = /\b([A-Z])(\d{2})(?:\.(\d))?\b/g;

export function parseCidCodes(
  text: string,
  crossRefValid?: (code: string) => boolean,
): ParseResult[] {
  const out: ParseResult[] = [];
  if (!text) return out;
  let m: RegExpExecArray | null;
  CID_RE.lastIndex = 0;
  const seen = new Set<string>();
  while ((m = CID_RE.exec(text)) !== null) {
    const code = m[3] ? `${m[1]}${m[2]}.${m[3]}` : `${m[1]}${m[2]}`;
    if (seen.has(code)) continue;
    seen.add(code);
    const validInCatalog = crossRefValid ? crossRefValid(code) : false;
    out.push({
      value: code,
      raw: m[0],
      confidence: validInCatalog ? 1.0 : 0.5,
      sources: [
        { kind: 'regex', score: 0.5 },
        ...(crossRefValid
          ? [{ kind: 'cross_ref' as const, score: validInCatalog ? 0.5 : 0 }]
          : []),
      ],
    });
  }
  return out;
}
