import { Injectable } from '@nestjs/common';
import {
  isFuzzyMatch,
  levenshteinDistance,
  normalizeNameForCompare,
} from '../tools/catalog.helpers';

/**
 * Status retornado pelo resolver. Espelha a semântica de matching usada por
 * todas as tools de lookup. As tools devolvem isso ao LLM via `LookupResult`.
 */
export type LookupStatus = 'resolved' | 'ambiguous' | 'not_found' | 'error';

export interface LookupCandidate<T> {
  id: string;
  label: string;
  /** Score combinado (0..1). Maior = mais similar à query. */
  score: number;
  data: T;
}

export interface LookupResult<T> {
  status: LookupStatus;
  query: string;
  resolved?: LookupCandidate<T>;
  candidates: LookupCandidate<T>[];
  message: string;
  hint?: string;
}

export interface ResolveOptions<T> {
  query: string;
  candidates: T[];
  getName: (item: T) => string;
  getId: (item: T) => string;
  /**
   * Aliases adicionais (ex.: nome social, sigla). Cada item retorna 0..N strings.
   */
  getAliases?: (item: T) => string[];
  /**
   * Score mínimo para considerar candidato (default 0.5). Abaixo disso descarta.
   */
  candidateThreshold?: number;
  /**
   * Score mínimo para `resolved` (default 0.85).
   */
  resolveThreshold?: number;
  /**
   * Diferença mínima entre top-1 e top-2 para resolver (default 0.15).
   * Garante que `resolved` só aparece quando há destaque claro.
   */
  minLeadOverNext?: number;
  /**
   * Limite de candidatos retornados (default 5).
   */
  maxCandidates?: number;
}

/**
 * Service que centraliza matching por similaridade para todas as tools de
 * lookup do assistente. Combina três sinais (exact > prefix > substring > Dice)
 * e calibra com Levenshtein para tolerar erros de transcrição / digitação.
 *
 * Premissas:
 * - As tools NÃO devem mais tokenizar nomes antes de fazer matching.
 *   A query chega como string real (após `detokenizeArg` do PII vault, se for
 *   o caso) e os candidatos vêm direto do banco.
 * - O resolver é puramente síncrono e sem efeitos colaterais. Buscar
 *   candidatos no banco é responsabilidade da tool chamadora.
 */
@Injectable()
export class EntityResolverService {
  /**
   * Resolve uma query contra uma lista de candidatos. Veja `ResolveOptions`
   * para configuração de thresholds. Retorna sempre um envelope tipado
   * com status, candidates e mensagem em pt-BR pronta para o LLM repassar.
   */
  resolve<T>(opts: ResolveOptions<T>): LookupResult<T> {
    const query = String(opts.query ?? '').trim();
    if (!query) {
      return {
        status: 'not_found',
        query,
        candidates: [],
        message: 'Consulta vazia.',
      };
    }

    const candidateThreshold = opts.candidateThreshold ?? 0.5;
    const resolveThreshold = opts.resolveThreshold ?? 0.85;
    const minLeadOverNext = opts.minLeadOverNext ?? 0.15;
    const maxCandidates = opts.maxCandidates ?? 5;

    const normalizedQuery = normalizeNameForCompare(query);
    if (!normalizedQuery) {
      return {
        status: 'not_found',
        query,
        candidates: [],
        message: 'Consulta vazia após normalização.',
      };
    }

    const scored: LookupCandidate<T>[] = [];
    for (const item of opts.candidates) {
      const name = opts.getName(item);
      const aliases = opts.getAliases ? opts.getAliases(item) : [];
      const names = [name, ...aliases].filter((s) => !!s && s.trim().length);
      let bestScore = 0;
      for (const candidateName of names) {
        const score = this.score(normalizedQuery, candidateName);
        if (score > bestScore) bestScore = score;
      }
      if (bestScore >= candidateThreshold) {
        scored.push({
          id: opts.getId(item),
          label: name,
          score: Number(bestScore.toFixed(4)),
          data: item,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxCandidates);

    if (top.length === 0) {
      return {
        status: 'not_found',
        query,
        candidates: [],
        message: `Nenhum registro encontrado para "${query}".`,
      };
    }

    const first = top[0];
    const second = top[1];

    const isResolved =
      first.score >= resolveThreshold &&
      (!second || first.score - second.score >= minLeadOverNext);

    if (isResolved) {
      return {
        status: 'resolved',
        query,
        resolved: first,
        candidates: top.slice(1),
        message: `Encontrado: ${first.label}.`,
      };
    }

    return {
      status: 'ambiguous',
      query,
      candidates: top,
      message: `Mais de um resultado possível para "${query}". Peça desambiguação.`,
      hint: top
        .map((c, idx) => `${idx + 1}) ${c.label} (id: ${c.id})`)
        .join('\n'),
    };
  }

  /**
   * Calcula o score combinado entre uma `normalizedQuery` (já normalizada
   * via `normalizeNameForCompare`) e um `candidateName` (cru). Avalia todos
   * os sinais em paralelo e devolve o MAIOR — assim não há cenário em que
   * um sinal mais fraco "esconde" um sinal mais forte (ex.: substring
   * curto x token match perfeito).
   *
   * Sinais avaliados:
   *  - exato após normalização    → 1.0
   *  - prefixo                    → 0.9 + 0.1 * ratio
   *  - substring (query ⊂ target) → 0.85 + 0.10 * ratio
   *  - substring (target ⊂ query) → 0.80 + 0.10 * ratio
   *  - Dice coefficient (bigramas)→ 0..1
   *  - Levenshtein normalizada    → 0..1
   *  - token a token              → score do melhor token × 0.95
   *
   * Em todos os casos o resultado é truncado a 4 casas (estável para tests).
   */
  score(normalizedQuery: string, candidateName: string): number {
    if (!candidateName) return 0;
    const target = normalizeNameForCompare(candidateName);
    if (!target) return 0;
    if (target === normalizedQuery) return 1;

    let best = 0;

    const ratio =
      Math.min(target.length, normalizedQuery.length) /
      Math.max(target.length, normalizedQuery.length);

    if (
      target.startsWith(normalizedQuery) ||
      normalizedQuery.startsWith(target)
    ) {
      best = Math.max(best, 0.9 + 0.1 * ratio);
    }
    if (target.includes(normalizedQuery)) {
      best = Math.max(best, 0.85 + 0.1 * ratio);
    }
    if (normalizedQuery.includes(target)) {
      best = Math.max(best, 0.8 + 0.1 * ratio);
    }

    best = Math.max(best, this.dice(normalizedQuery, target));
    best = Math.max(best, this.levenshteinNormalized(normalizedQuery, target));

    // Matching palavra-a-palavra: útil quando o usuário diz só parte
    // ("Albert Einstein" vs "Hospital Israelita Albert Einstein").
    // A query inteira é comparada contra cada token do target. Multi-token
    // queries também: separa e tenta casar bag-of-tokens (sem ordem).
    const targetTokens = target.split(/\s+/).filter((t) => t.length >= 3);
    const queryTokens = normalizedQuery
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    for (const token of targetTokens) {
      const tokenDice = this.dice(normalizedQuery, token);
      const tokenLev = this.levenshteinNormalized(normalizedQuery, token);
      const tokenBest = Math.max(tokenDice, tokenLev) * 0.95;
      if (tokenBest > best) best = tokenBest;
    }

    if (queryTokens.length > 1 && targetTokens.length > 0) {
      let tokenCoverage = 0;
      let perTokenSum = 0;
      for (const qt of queryTokens) {
        let bestTokenScore = 0;
        for (const tt of targetTokens) {
          const ts = Math.max(
            this.dice(qt, tt),
            this.levenshteinNormalized(qt, tt),
          );
          if (ts > bestTokenScore) bestTokenScore = ts;
        }
        if (bestTokenScore >= 0.85) tokenCoverage += 1;
        perTokenSum += bestTokenScore;
      }
      const coverage = tokenCoverage / queryTokens.length;
      const avg = perTokenSum / queryTokens.length;
      const bagScore = coverage * 0.6 + avg * 0.4;
      if (bagScore > best) best = bagScore;
    }

    return Number(best.toFixed(4));
  }

  /**
   * Sørensen–Dice por bigramas (com fallback para unigramas em strings
   * muito curtas). Retorna 0..1.
   */
  dice(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) {
      // Unigrama por segurança.
      const setA = new Set(a.split(''));
      const setB = new Set(b.split(''));
      const intersection = [...setA].filter((c) => setB.has(c)).length;
      const total = setA.size + setB.size;
      return total === 0 ? 0 : (2 * intersection) / total;
    }
    const bigramsA = this.bigrams(a);
    const bigramsB = this.bigrams(b);
    let matches = 0;
    const bCounts = new Map<string, number>();
    for (const bg of bigramsB) {
      bCounts.set(bg, (bCounts.get(bg) ?? 0) + 1);
    }
    for (const bg of bigramsA) {
      const c = bCounts.get(bg) ?? 0;
      if (c > 0) {
        matches += 1;
        bCounts.set(bg, c - 1);
      }
    }
    return (2 * matches) / (bigramsA.length + bigramsB.length);
  }

  private bigrams(s: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) {
      out.push(s.slice(i, i + 2));
    }
    return out;
  }

  /**
   * Levenshtein normalizada para [0..1] como similaridade: 1 - dist/maxLen.
   */
  levenshteinNormalized(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const dist = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 0;
    return 1 - dist / maxLen;
  }

  /**
   * Helper retrocompatível para tools que ainda usam o predicado booleano.
   * Mantém o threshold ~0.3 (distância / maxLen) do código legado em
   * `catalog.helpers.ts`, agora delegado ao resolver.
   */
  isFuzzyMatch(a: string, b: string, threshold = 0.3): boolean {
    return isFuzzyMatch(a, b, threshold);
  }
}
