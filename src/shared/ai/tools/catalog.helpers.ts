import { Logger } from '@nestjs/common';
import { ToolContext } from './tool.interface';
import { UserRepository } from '../../../database/repositories/user.repository';

const logger = new Logger('CatalogHelpers');

export function normalizeNameForCompare(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export async function resolveOwnerIdFromContext(
  context: ToolContext,
  userRepo?: UserRepository | null,
): Promise<string | null> {
  if (context.ownerId) return context.ownerId;
  if (!context.userId || !userRepo) return null;
  try {
    const user = await userRepo.findOne({ id: context.userId });
    return user?.ownerId ?? null;
  } catch (err) {
    logger.warn(
      `[CATALOG] falha ao resolver ownerId user=${context.userId}: ${(err as Error)?.message}`,
    );
    return null;
  }
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        prev[j] = prevDiag;
      } else {
        prev[j] = 1 + Math.min(prev[j - 1], prev[j], prevDiag);
      }
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

export function isFuzzyMatch(a: string, b: string, threshold = 0.3): boolean {
  if (!a || !b) return false;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return false;
  if (longest <= 3) return a === b;
  const distance = levenshteinDistance(a, b);
  return distance / longest <= threshold;
}
