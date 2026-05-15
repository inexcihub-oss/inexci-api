import { ParseResult } from './parser.types';

const CNPJ_RE = /\b(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})\b/g;

export function isValidCnpjChecksum(digits: string): boolean {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calc = (slice: string, factors: number[]): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * factors[i];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const fac1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const fac2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dv1 = calc(digits.slice(0, 12), fac1);
  const dv2 = calc(digits.slice(0, 13), fac2);
  return dv1 === Number(digits[12]) && dv2 === Number(digits[13]);
}

function format(digits: string): string {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function parseCnpjs(text: string): ParseResult[] {
  const out: ParseResult[] = [];
  if (!text) return out;
  let m: RegExpExecArray | null;
  CNPJ_RE.lastIndex = 0;
  const seen = new Set<string>();
  while ((m = CNPJ_RE.exec(text)) !== null) {
    const digits = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`;
    if (seen.has(digits)) continue;
    seen.add(digits);
    const valid = isValidCnpjChecksum(digits);
    out.push({
      value: format(digits),
      raw: m[0],
      confidence: valid ? 1.0 : 0.4,
      sources: [
        { kind: 'regex', score: 0.4 },
        { kind: 'checksum', score: valid ? 0.6 : 0 },
      ],
    });
  }
  return out;
}
