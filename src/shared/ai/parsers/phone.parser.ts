import { ParseResult } from './parser.types';

// Mantém o `9` opcional como parte do bloco de dígitos (grupo 2), em
// vez de consumi-lo separadamente — isso evita perder o nono dígito em
// `(11) 98765-4321`. O regex aceita números fixos (8 dígitos) e celulares
// (9 dígitos com 9 inicial).
const PHONE_RE = /\b(?:\+?55\s*)?\(?(\d{2})\)?\s*(9?\d{4,5})[\s.-]?(\d{4})\b/g;

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, 27, 28, // RJ/ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, 65, 66, 67, 68, 69, // GO/MT/MS/AC/RO
  71, 73, 74, 75, 77, 79, // BA/SE
  81, 82, 83, 84, 85, 86, 87, 88, 89, // NE
  91, 92, 93, 94, 95, 96, 97, 98, 99, // N
]);

function format(ddd: string, body: string): string {
  if (body.length === 9) {
    return `(${ddd}) ${body.slice(0, 5)}-${body.slice(5)}`;
  }
  return `(${ddd}) ${body.slice(0, 4)}-${body.slice(4)}`;
}

export function parsePhones(text: string): ParseResult[] {
  const out: ParseResult[] = [];
  if (!text) return out;
  PHONE_RE.lastIndex = 0;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PHONE_RE.exec(text)) !== null) {
    const ddd = m[1];
    if (!VALID_DDDS.has(Number(ddd))) continue;
    const body = `${m[2]}${m[3]}`;
    if (body.length < 8 || body.length > 9) continue;
    const value = format(ddd, body);
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
