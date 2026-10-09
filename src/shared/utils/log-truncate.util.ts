const DEFAULT_MAX_CHARS = 500;

export function truncateForLog(
  value: string | null | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text) return null;
  if (text.length <= maxChars) return text;
  const removed = text.length - maxChars;
  return `${text.slice(0, maxChars)}…[truncated:${removed}]`;
}

export function truncateErrorForLog(
  err: unknown,
  maxChars: number = DEFAULT_MAX_CHARS,
): string | null {
  if (err === null || err === undefined) return null;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return truncateForLog(message, maxChars);
}
