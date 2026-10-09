import { ToolContext } from './tool.interface';
import { UserRepository } from '../../../database/repositories/user.repository';

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
    const user = await userRepo.findOne({ id: context.userId } as any);
    return user?.ownerId ?? null;
  } catch {
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

export async function findOwnedByNormalizedName<
  T extends { id: string; name: string },
>(
  repo: {
    findOne: (where: any) => Promise<T | null>;
    findMany: (where: any, skip?: number, take?: number) => Promise<T[]>;
  },
  rawName: string,
  ownerId: string | null,
): Promise<T | null> {
  const trimmed = String(rawName || '').trim();
  if (!trimmed) return null;
  const exact = await repo.findOne({
    name: trimmed,
    ...(ownerId ? { ownerId } : {}),
  });
  if (exact) return exact;

  const candidates = await repo.findMany(
    ownerId ? ({ ownerId } as any) : ({} as any),
    0,
    200,
  );
  const target = normalizeNameForCompare(trimmed);

  const equalMatch = candidates.find(
    (item) => normalizeNameForCompare(item.name) === target,
  );
  if (equalMatch) return equalMatch;

  const partialMatch = candidates.find((item) => {
    const itemName = normalizeNameForCompare(item.name);
    return (
      !!itemName && (itemName.includes(target) || target.includes(itemName))
    );
  });
  if (partialMatch) return partialMatch;

  let bestScore = Number.POSITIVE_INFINITY;
  let bestItem: T | null = null;
  for (const item of candidates) {
    const itemName = normalizeNameForCompare(item.name);
    if (!itemName) continue;

    const fullScore =
      levenshteinDistance(itemName, target) /
      Math.max(itemName.length, target.length);
    if (isFuzzyMatch(itemName, target) && fullScore < bestScore) {
      bestScore = fullScore;
      bestItem = item;
      continue;
    }
    for (const token of itemName.split(/\s+/)) {
      if (token.length < 4) continue;
      const tokenScore =
        levenshteinDistance(token, target) /
        Math.max(token.length, target.length);
      if (isFuzzyMatch(token, target) && tokenScore < bestScore) {
        bestScore = tokenScore;
        bestItem = item;
      }
    }
  }
  return bestItem;
}
