import { ParseResult } from './parser.types';

const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const BR_RE = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;
const PT_LONG_RE =
  /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(\d{2,4})\b/gi;

const PT_MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function pad2(n: number | string): string {
  return String(n).padStart(2, '0');
}

function isoDateString(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Extrai datas em formatos ISO, BR (`dd/mm/yyyy`) e por extenso PT-BR.
 * Devolve sempre no formato ISO `yyyy-mm-dd`.
 */
export function parseDates(text: string): ParseResult[] {
  const out: ParseResult[] = [];
  if (!text) return out;
  const seen = new Set<string>();

  let m: RegExpExecArray | null;

  ISO_RE.lastIndex = 0;
  while ((m = ISO_RE.exec(text)) !== null) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!isValidYmd(y, mo, d)) continue;
    const value = isoDateString(y, mo, d);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      raw: m[0],
      confidence: 0.95,
      sources: [{ kind: 'regex', score: 0.95 }],
    });
  }

  BR_RE.lastIndex = 0;
  while ((m = BR_RE.exec(text)) !== null) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y = y >= 70 ? 1900 + y : 2000 + y;
    if (!isValidYmd(y, mo, d)) continue;
    const value = isoDateString(y, mo, d);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      raw: m[0],
      confidence: 0.85,
      sources: [{ kind: 'regex', score: 0.85 }],
    });
  }

  PT_LONG_RE.lastIndex = 0;
  while ((m = PT_LONG_RE.exec(text)) !== null) {
    const d = Number(m[1]);
    const mo = PT_MONTHS[m[2].toLowerCase()];
    let y = Number(m[3]);
    if (m[3].length === 2) y = y >= 70 ? 1900 + y : 2000 + y;
    if (!isValidYmd(y, mo, d)) continue;
    const value = isoDateString(y, mo, d);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      raw: m[0],
      confidence: 0.9,
      sources: [{ kind: 'regex', score: 0.9 }],
    });
  }

  return out;
}
