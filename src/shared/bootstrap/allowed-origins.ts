export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '').toLowerCase();
}

export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(normalizeOrigin(origin));
}
