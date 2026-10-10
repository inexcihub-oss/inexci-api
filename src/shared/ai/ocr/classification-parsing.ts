import {
  DocumentClassificationCidItem,
  DocumentClassificationKind,
  DocumentClassificationOpmeItem,
  DocumentClassificationTussItem,
} from './document-classifier.types';

export type RawRecord = Record<string, unknown>;

export function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

export function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalTrimmed(value: unknown): string | undefined {
  return trimmedString(value) || undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseKind(
  value: unknown,
  supported: readonly string[],
): DocumentClassificationKind {
  return typeof value === 'string' && supported.includes(value)
    ? (value as DocumentClassificationKind)
    : 'unknown';
}

export function parseConfidence(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

export function parseSuggestedDocumentType(
  value: unknown,
  supported: readonly string[],
): string {
  const raw = typeof value === 'string' ? value : '';
  return supported.includes(raw) ? raw : 'additional_document';
}

export function coalesceStringFields<K extends string>(
  raw: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as RawRecord;
  const out: Partial<Record<K, string>> = {};
  let hasValue = false;
  for (const key of keys) {
    const value = trimmedString(source[key]);
    if (value) {
      out[key] = value;
      hasValue = true;
    }
  }
  return hasValue ? out : undefined;
}

export function parseTussItems(
  raw: unknown,
  opts: { withQty: boolean },
): DocumentClassificationTussItem[] {
  return asArray(raw)
    .map((value) => {
      const item = asRecord(value);
      const parsed: DocumentClassificationTussItem = {
        code: trimmedString(item.code),
        description: trimmedString(item.description),
      };
      if (opts.withQty) {
        parsed.qty =
          typeof item.qty === 'number' && item.qty >= 1 ? item.qty : undefined;
      }
      return parsed;
    })
    .filter((item) => item.code);
}

export function parseCidItems(raw: unknown): DocumentClassificationCidItem[] {
  return asArray(raw)
    .map((value) => ({ code: trimmedString(asRecord(value).code) }))
    .filter((item) => item.code);
}

export function parseOpmeItems(raw: unknown): DocumentClassificationOpmeItem[] {
  return asArray(raw)
    .map((value) => {
      const item = asRecord(value);
      const qty = Number(item.qty);
      const entry: DocumentClassificationOpmeItem = {
        description: trimmedString(item.description),
        qty: Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : 1,
      };
      const supplier = trimmedString(item.supplier);
      if (supplier) entry.supplier = supplier;
      const manufacturer = trimmedString(item.manufacturer);
      if (manufacturer) entry.manufacturer = manufacturer;
      return entry;
    })
    .filter((item) => item.description);
}

export function parseStringItems(raw: unknown): string[] {
  return asArray(raw)
    .map(trimmedString)
    .filter((s) => s.length > 0);
}
