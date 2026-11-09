import { createHash } from 'crypto';
import type { PlatformErrorSource } from 'src/database/entities/platform-error-daily.entity';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { maskSensitiveText } from 'src/shared/utils/mask.util';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const HEX_ID = /\b[0-9a-f]{16,}\b/gi;
const NUMBER = /\d+/g;
const MESSAGE_MAX = 300;
const ROUTE_MAX = 200;

export function errorClassOf(error: unknown): string {
  if (error instanceof Error) {
    return (error.constructor?.name || error.name || 'Error').slice(0, 100);
  }
  if (error === null) return 'null';
  return typeof error;
}

export function normalizeRoute(
  route: string | null | undefined,
): string | null {
  if (!route) return null;
  const path = route.split('?')[0];
  return path
    .replace(UUID, ':id')
    .replace(HEX_ID, ':id')
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) ? ':n' : segment))
    .join('/')
    .slice(0, ROUTE_MAX);
}

export function normalizeMessageForFingerprint(message: string): string {
  return message
    .replace(UUID, ':id')
    .replace(EMAIL, ':email')
    .replace(HEX_ID, ':id')
    .replace(NUMBER, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

export function sanitizeErrorMessage(error: unknown): string | null {
  const raw = errorMessage(error).trim();
  if (!raw) return null;
  const clean = maskSensitiveText(raw);
  return clean.length > MESSAGE_MAX
    ? `${clean.slice(0, MESSAGE_MAX - 3)}...`
    : clean;
}

export function fingerprintOf(
  source: PlatformErrorSource,
  route: string | null,
  errorClass: string,
  error: unknown,
): string {
  const key = [
    source,
    route ?? '',
    errorClass,
    normalizeMessageForFingerprint(errorMessage(error)),
  ].join('|');
  return createHash('sha256').update(key).digest('hex');
}
