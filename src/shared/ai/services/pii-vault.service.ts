import { Injectable, Logger } from '@nestjs/common';

export type PiiCategory =
  | 'patient_name'
  | 'doctor_name'
  | 'hospital_name'
  | 'health_plan_name'
  | 'cpf'
  | 'cns'
  | 'health_plan_card'
  | 'rg'
  | 'phone'
  | 'email'
  | 'address'
  | 'protocol'
  | 'date'
  | 'birth_date'
  | 'medical_report'
  | 'patient_history'
  | 'diagnosis'
  | 'surgery_description'
  | 'payload_blob';

export const ALL_PII_CATEGORIES: PiiCategory[] = [
  'patient_name',
  'doctor_name',
  'hospital_name',
  'health_plan_name',
  'cpf',
  'cns',
  'health_plan_card',
  'rg',
  'phone',
  'email',
  'address',
  'protocol',
  'date',
  'birth_date',
  'medical_report',
  'patient_history',
  'diagnosis',
  'surgery_description',
  'payload_blob',
];

const RG_REGEX = /\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b/g;

const CPF_SEPARADO_REGEX =
  /(?<!\d)\d{3}(?:\s*[.-]\s*|\s+)\d{3}(?:\s*[.-]\s*|\s+)\d{3}(?:\s*[.-]\s*|\s+)\d{2}(?!\d)/g;

const CNS_REGEX =
  /(?<!\d)[12789]\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)/g;

const CARTEIRINHA_ROTULADA_REGEX =
  /(\b(?:carteirinha|carteira\s+do\s+(?:conv[êe]nio|plano)|matr[íi]cula|n[úu]mero\s+d[aeo]\s+(?:carteirinha|conv[êe]nio|plano)|n[º°o]\.?\s*d[aeo]\s+(?:carteirinha|conv[êe]nio|plano)|c[óo]digo\s+do\s+benefici[áa]rio)(?:\s+do\s+(?:conv[êe]nio|plano))?\s*(?:[:#=-]|[ée]|n[º°o]\.?)?\s*)(\d(?:\d|[.\-/ ](?=\d)){4,30})/gi;

function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

export function cpfValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (len: number): number => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

export function cnsValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 15 || !/^[12789]/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 15; i++) soma += Number(d[i]) * (15 - i);
  return soma % 11 === 0;
}

export interface PiiBinding {
  token: string;
  category: PiiCategory;
  realValue: string;
}

export type SerializedPiiBindings = PiiBinding[];

export interface ResidualPiiFinding {
  category: PiiCategory;
  sample: string;
}

function normalizeRealValueForCategory(
  category: PiiCategory,
  rawValue: string,
): string {
  if (category !== 'protocol') return rawValue;
  let value = rawValue;
  while (/^sc-/i.test(value)) {
    value = value.replace(/^sc-/i, '').trim();
  }
  return value;
}

@Injectable()
export class PiiVaultService {
  private readonly logger = new Logger(PiiVaultService.name);
  private readonly bindings = new Map<string, PiiBinding[]>();

  startSession(sessionId: string): void {
    if (!sessionId) return;
    if (!this.bindings.has(sessionId)) {
      this.bindings.set(sessionId, []);
    }
  }

  endSession(sessionId: string): void {
    if (!sessionId) return;
    this.bindings.delete(sessionId);
  }

  restoreSession(
    sessionId: string,
    bindings: SerializedPiiBindings | null | undefined,
  ): void {
    if (!sessionId) return;
    const list = this.bindings.get(sessionId) ?? [];
    if (!bindings?.length) {
      this.bindings.set(sessionId, list);
      return;
    }
    for (const incoming of bindings) {
      if (
        !incoming ||
        typeof incoming.token !== 'string' ||
        typeof incoming.realValue !== 'string'
      ) {
        continue;
      }
      const normalizedRealValue = normalizeRealValueForCategory(
        incoming.category,
        incoming.realValue,
      );
      const exists = list.some(
        (b) =>
          b.category === incoming.category &&
          b.realValue === normalizedRealValue,
      );
      if (exists) continue;
      list.push({
        token: incoming.token,
        category: incoming.category,
        realValue: normalizedRealValue,
      });
    }
    this.bindings.set(sessionId, list);
  }

  serializeSession(sessionId: string): SerializedPiiBindings {
    return [...(this.bindings.get(sessionId) ?? [])].map((b) => ({
      token: b.token,
      category: b.category,
      realValue: b.realValue,
    }));
  }

  tokenize(
    sessionId: string,
    value: string | number | null | undefined,
    category: PiiCategory,
  ): string {
    if (value === null || value === undefined) return '';
    const rawString = String(value).trim();
    if (!rawString) return '';
    const stringValue = normalizeRealValueForCategory(category, rawString);
    if (!stringValue) return '';
    if (!sessionId) return stringValue;

    const list = this.bindings.get(sessionId) ?? [];
    const existing = list.find(
      (b) => b.category === category && b.realValue === stringValue,
    );
    if (existing) return existing.token;

    const indexForCategory =
      list.filter((b) => b.category === category).length + 1;
    const token = `{{${category}_${indexForCategory}}}`;
    list.push({ token, category, realValue: stringValue });
    this.bindings.set(sessionId, list);
    return token;
  }

  detokenize(sessionId: string, text: string): string {
    if (!text || !sessionId) return text || '';
    const list = this.bindings.get(sessionId);
    if (!list?.length) return text;

    let output = text;
    for (const binding of list) {
      if (output.includes(binding.token)) {
        output = output.split(binding.token).join(binding.realValue);
      }
    }
    return output;
  }

  preprocessUserInput(
    sessionId: string,
    rawInput: string,
    options?: { blobThreshold?: number },
  ): string {
    if (!rawInput) return '';
    let out = rawInput;

    out = out.replace(
      CARTEIRINHA_ROTULADA_REGEX,
      (_match, rotulo: string, numero: string) =>
        `${rotulo}${this.tokenize(sessionId, numero, 'health_plan_card')}`,
    );

    out = out.replace(CNS_REGEX, (match) =>
      cnsValido(match) ? this.tokenize(sessionId, match, 'cns') : match,
    );

    out = out.replace(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/g, (match) =>
      this.tokenize(sessionId, match, 'cpf'),
    );

    out = out.replace(CPF_SEPARADO_REGEX, (match) =>
      cpfValido(match) ? this.tokenize(sessionId, match, 'cpf') : match,
    );

    out = out.replace(RG_REGEX, (match) =>
      this.tokenize(sessionId, match, 'rg'),
    );

    out = out.replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, (match) =>
      this.tokenize(sessionId, match, 'phone'),
    );

    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (match) =>
      this.tokenize(sessionId, match, 'email'),
    );

    const threshold = options?.blobThreshold ?? Number.POSITIVE_INFINITY;
    if (Number.isFinite(threshold) && out.length > threshold) {
      out = this.tokenize(sessionId, out, 'payload_blob');
    }

    return out;
  }

  detectResidualPii(text: string): ResidualPiiFinding[] {
    const findings: ResidualPiiFinding[] = [];
    if (!text) return findings;

    const cpf =
      text.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/)?.[0] ??
      [...text.matchAll(CPF_SEPARADO_REGEX)].map((m) => m[0]).find(cpfValido);
    if (cpf) findings.push({ category: 'cpf', sample: cpf });

    const cns = [...text.matchAll(CNS_REGEX)].map((m) => m[0]).find(cnsValido);
    if (cns) findings.push({ category: 'cns', sample: cns });

    const rg = text.match(/\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b/);
    if (rg) findings.push({ category: 'rg', sample: rg[0] });

    const phone = text.match(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/);
    if (phone) findings.push({ category: 'phone', sample: phone[0] });

    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) findings.push({ category: 'email', sample: email[0] });

    return findings;
  }

  maskLiteralPii(text: string): {
    text: string;
    masked: { category: PiiCategory; count: number }[];
  } {
    if (!text) return { text: text ?? '', masked: [] };

    const placeholderRanges: Array<[number, number]> = [];
    const placeholderRegex = /\{\{[a-z_]+_\d+\}\}/gi;
    let placeholderMatch: RegExpExecArray | null;
    while ((placeholderMatch = placeholderRegex.exec(text)) !== null) {
      placeholderRanges.push([
        placeholderMatch.index,
        placeholderMatch.index + placeholderMatch[0].length,
      ]);
    }

    const overlapsPlaceholder = (start: number, end: number): boolean =>
      placeholderRanges.some(
        ([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart,
      );

    const counters: Record<string, number> = {};
    const replacements: Array<{
      start: number;
      end: number;
      mask: string;
      category: PiiCategory;
    }> = [];

    const collect = (
      regex: RegExp,
      category: PiiCategory,
      mask: string,
      valida?: (valor: string) => boolean,
    ): void => {
      const localRegex = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = localRegex.exec(text)) !== null) {
        if (valida && !valida(match[0])) continue;
        const start = match.index;
        const end = start + match[0].length;
        if (overlapsPlaceholder(start, end)) continue;
        if (replacements.some((r) => start < r.end && end > r.start)) {
          continue;
        }
        replacements.push({ start, end, mask, category });
        counters[category] = (counters[category] ?? 0) + 1;
      }
    };

    collect(CNS_REGEX, 'cns', 'NNN NNNN NNNN NNNN', cnsValido);
    collect(
      /\b(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})\b/g,
      'cpf',
      'XXX.XXX.XXX-XX',
    );
    collect(CPF_SEPARADO_REGEX, 'cpf', 'XXX.XXX.XXX-XX', cpfValido);
    collect(/\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b/g, 'rg', 'XX.XXX.XXX-X');
    collect(
      /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g,
      'phone',
      '(DDD) NNNNN-NNNN',
    );
    collect(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'email', 'exemplo@dominio.com');

    if (!replacements.length) {
      return { text, masked: [] };
    }

    replacements.sort((a, b) => a.start - b.start);

    let output = '';
    let cursor = 0;
    for (const replacement of replacements) {
      if (replacement.start < cursor) continue;
      output += text.slice(cursor, replacement.start);
      output += replacement.mask;
      cursor = replacement.end;
    }
    output += text.slice(cursor);

    const masked = Object.entries(counters).map(([category, count]) => ({
      category: category as PiiCategory,
      count,
    }));

    return { text: output, masked };
  }

  hashValue(value: string): string {
    if (!value) return '';
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  snapshot(sessionId: string): PiiBinding[] {
    return [...(this.bindings.get(sessionId) ?? [])];
  }

  categoryCounts(sessionId: string): Record<PiiCategory, number> {
    const counts: Record<string, number> = {};
    for (const cat of ALL_PII_CATEGORIES) counts[cat] = 0;
    for (const binding of this.bindings.get(sessionId) ?? []) {
      counts[binding.category] = (counts[binding.category] ?? 0) + 1;
    }
    return counts;
  }
}
