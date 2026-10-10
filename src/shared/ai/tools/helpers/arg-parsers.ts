export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function asPositiveInt(value: unknown, fallback = 1): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function asValidDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return value;
}

export function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }

  const single = asNonEmptyString(value);
  if (!single) return [];

  return single
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDatePtBr(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('pt-BR');
}

export function sanitizeAlphaNumKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export function asScalarArg(
  value: unknown,
): string | number | null | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return null;
  return undefined;
}

export function argToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'symbol') return value.toString();
  if (Array.isArray(value)) {
    return value
      .map((item: unknown) => (item == null ? '' : argToString(item)))
      .join(',');
  }
  return Object.prototype.toString.call(value);
}
