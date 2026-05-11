import { ToolContext } from './tool.interface';
import { UserRepository } from '../../../database/repositories/user.repository';

/**
 * Normaliza string para comparação: NFD + remove diacríticos + trim + lowercase.
 * Útil para casar "Albert Einstein" com "albert einstein" / "Albert  Einstein"
 * vindas do usuário no WhatsApp.
 */
export function normalizeNameForCompare(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Resolve o `ownerId` da clínica do usuário corrente.
 *
 * Preferimos `context.ownerId` (injetado pelo orchestrator) e caímos em uma
 * consulta ao `userRepo` quando o contexto vier sem esse dado — útil para
 * tools chamadas em testes legados.
 */
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

/**
 * Distância de Levenshtein iterativa em O(n*m) tempo / O(m) espaço.
 * Usada para tolerar pequenas variações de transcrição/digitação no nome
 * de hospitais e convênios (ex.: "Unimed" vs "Unimedia" vs "Unimédio").
 */
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

/**
 * Considera dois nomes "fuzzy-equivalentes" se a distância de Levenshtein
 * normalizada (Lev / max(len_a, len_b)) for menor que 0.30 — ou seja, até
 * ~30% de diferença de caracteres. Tolerante o suficiente para pegar
 * "unimed" ≈ "unimedia" ≈ "unimedio", mas restritivo para evitar falsos
 * positivos como "unimed" ≈ "amil" (distância 4 / max 6 = 0.66).
 */
export function isFuzzyMatch(a: string, b: string, threshold = 0.3): boolean {
  if (!a || !b) return false;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return false;
  // Curto demais para confiar em fuzzy: exige igualdade ou prefixo claro.
  if (longest <= 3) return a === b;
  const distance = levenshteinDistance(a, b);
  return distance / longest <= threshold;
}

/**
 * Busca um recurso "owned" por nome (case/diacritic-insensitive) dentro
 * de um `ownerId`. Faz QUATRO tentativas, da mais restritiva para a mais
 * tolerante:
 *
 *   1. match exato (já cadastrado tal qual);
 *   2. match insensível a caixa e acentos sobre uma página de até 200 itens;
 *   3. inclusão parcial (substring);
 *   4. fuzzy (Levenshtein normalizada ≤ 30%) — pega variações de
 *      transcrição como "Unimed" / "Unimedia" / "Unimédio".
 */
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

  // Fallback fuzzy — escolhe o candidato com menor distância normalizada
  // que ainda esteja dentro do threshold. Comparado nome-completo a
  // nome-completo, depois cada PALAVRA do candidato contra o alvo
  // (cobre "Hospital Sírio-Libanês" vs entrada "Sírio").
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
    // Compara palavra a palavra: útil quando o usuário fala só parte do
    // nome ("Albert Einstein" vs "Hospital Israelita Albert Einstein").
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
