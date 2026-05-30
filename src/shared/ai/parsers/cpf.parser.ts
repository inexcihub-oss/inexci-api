import { ParseResult } from './parser.types';

const CPF_RE = /\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g;

/**
 * Validador oficial do dígito verificador do CPF (módulo 11).
 */
export function isValidCpfChecksum(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calc = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (factorStart - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const dv1 = calc(digits.slice(0, 9), 10);
  const dv2 = calc(digits.slice(0, 10), 11);
  return dv1 === Number(digits[9]) && dv2 === Number(digits[10]);
}

/** Normaliza para formato `123.456.789-00`. */
function format(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Extrai todos os CPFs válidos do texto.
 * `confidence`:
 *  - regex match: 0.4
 *  - + checksum válido: +0.6 → total 1.0
 *  - + checksum inválido: 0.4 mas marcado em `sources`
 */
export function parseCpfs(text: string): ParseResult[] {
  const results: ParseResult[] = [];
  if (!text) return results;
  let match: RegExpExecArray | null;
  CPF_RE.lastIndex = 0;
  const seen = new Set<string>();
  while ((match = CPF_RE.exec(text)) !== null) {
    const digits = `${match[1]}${match[2]}${match[3]}${match[4]}`;
    if (seen.has(digits)) continue;
    seen.add(digits);
    const valid = isValidCpfChecksum(digits);
    results.push({
      value: format(digits),
      raw: match[0],
      confidence: valid ? 1.0 : 0.4,
      sources: [
        { kind: 'regex', score: 0.4 },
        { kind: 'checksum', score: valid ? 0.6 : 0 },
      ],
    });
  }
  return results;
}
