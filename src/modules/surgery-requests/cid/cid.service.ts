import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { FindManyCidDto } from './dto/find-many-cid.controller.dto';

export interface CidResponse {
  id: string;
  code: string;
  description: string;
}

interface CidJsonRow {
  codigo: string;
  descricao: string;
}

interface CidRecordInternal extends CidResponse {
  /** Código normalizado (sem ponto, uppercase) — usado para matching. */
  codeNormalized: string;
  /** Descrição normalizada (lowercase, sem acento, sem caracteres especiais). */
  descriptionNormalized: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 hora (dados estáticos)

/**
 * Tabela CID-10 carregada de `src/utils/cid.json`.
 *
 * Suporta dois modos de busca:
 *  - `findAll()` — controller HTTP (`GET /surgery-requests/cid?search=...`).
 *  - `lookup()` — IA do WhatsApp, com ranking inteligente para código
 *    completo, parcial (com ou sem ponto), descrição completa ou parcial.
 *    O CID admite forma "M17.1" e "M171" — ambas são equivalentes.
 */
@Injectable()
export class CidService {
  private readonly cache = new Map<string, CacheEntry<any>>();
  private allRecords: CidRecordInternal[] | null = null;

  private loadAll(): CidRecordInternal[] {
    if (this.allRecords) return this.allRecords;

    const filePath = path.join(process.cwd(), 'src', 'utils', 'cid.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json: { rows: CidJsonRow[] } = JSON.parse(raw);

    this.allRecords = json.rows.map((row) => ({
      id: row.codigo,
      code: row.codigo,
      description: row.descricao,
      codeNormalized: this.normalizeCode(row.codigo),
      descriptionNormalized: this.normalizeText(row.descricao),
    }));

    return this.allRecords;
  }

  /**
   * Busca paginada usada pelo controller HTTP. Mantém a mesma assinatura
   * (`{ total, records }`) para preservar o contrato com o frontend, mas
   * passa a aplicar o ranking inteligente quando há `search`.
   */
  findAll(query: FindManyCidDto): { total: number; records: CidResponse[] } {
    const { search, skip = 0, take = 50 } = query;
    const cacheKey = `cid:findAll:${search ?? ''}:${skip}:${take}`;

    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const all = this.loadAll();

    let filtered: CidRecordInternal[] = all;
    if (search && search.trim().length >= 2) {
      filtered = this.rankMatches(all, search);
    }

    const total = filtered.length;
    const records: CidResponse[] = filtered
      .slice(skip, skip + take)
      .map(this.toResponse);

    const result = { total, records };
    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }

  /**
   * Busca usada pela IA do WhatsApp. Aceita query em qualquer formato
   * (código completo/parcial com ou sem ponto, descrição completa/parcial)
   * e devolve resultados ordenados por relevância.
   */
  lookup(query: string, limit: number = 10): CidResponse[] {
    const trimmed = (query ?? '').trim();
    if (!trimmed) return [];

    const cacheKey = `cid:lookup:${trimmed.toLowerCase()}:${limit}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const all = this.loadAll();
    const ranked = this.rankMatches(all, trimmed)
      .slice(0, limit)
      .map(this.toResponse);

    this.cache.set(cacheKey, { value: ranked, expiresAt: Date.now() + TTL_MS });
    return ranked;
  }

  /**
   * Conveniência para localizar EXATAMENTE um CID (com ou sem ponto, em
   * qualquer caixa). Devolve `null` quando não há match exato.
   */
  findByExactCode(code: string): CidResponse | null {
    const normalized = this.normalizeCode(code);
    if (!normalized) return null;

    const all = this.loadAll();
    const match = all.find((item) => item.codeNormalized === normalized);
    return match ? this.toResponse(match) : null;
  }

  private rankMatches(
    records: CidRecordInternal[],
    rawQuery: string,
  ): CidRecordInternal[] {
    const queryCode = this.normalizeCode(rawQuery);
    const queryDescription = this.normalizeText(rawQuery);
    const queryTokens = queryDescription.split(/\s+/).filter(Boolean);

    if (!queryCode && queryTokens.length === 0) return [];

    const scored: Array<{ record: CidRecordInternal; score: number }> = [];

    for (const record of records) {
      const score = this.scoreRecord(
        record,
        queryCode,
        queryDescription,
        queryTokens,
      );
      if (score > 0) scored.push({ record, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.record.codeNormalized.localeCompare(b.record.codeNormalized);
    });

    return scored.map((entry) => entry.record);
  }

  private scoreRecord(
    record: CidRecordInternal,
    queryCode: string,
    queryDescription: string,
    queryTokens: string[],
  ): number {
    let score = 0;

    if (queryCode) {
      if (record.codeNormalized === queryCode) {
        score += 1000;
      } else if (record.codeNormalized.startsWith(queryCode)) {
        score += 600;
      } else if (record.codeNormalized.includes(queryCode)) {
        score += 250;
      }
    }

    if (queryTokens.length > 0) {
      const exactMatch = record.descriptionNormalized === queryDescription;
      const startsWithQuery =
        record.descriptionNormalized.startsWith(queryDescription);
      const containsQuery =
        queryDescription.length > 0 &&
        record.descriptionNormalized.includes(queryDescription);

      if (exactMatch) {
        score += 800;
      } else if (startsWithQuery) {
        score += 400;
      } else if (containsQuery) {
        score += 200;
      }

      // Bonus quando todos os tokens (>= 2) aparecem no nome — útil quando
      // o usuário fala palavras fora de ordem (ex.: "joelho artrose").
      if (queryTokens.length > 1) {
        const allTokensMatch = queryTokens.every((token) =>
          record.descriptionNormalized.includes(token),
        );
        if (allTokensMatch && !containsQuery) score += 150;
      }
    }

    return score;
  }

  /**
   * Normaliza código CID: uppercase, sem ponto, sem espaço. Aceita entrada
   * "M17.1", "m171", "m 17 1" → "M171".
   *
   * Observação: queries puramente textuais (ex.: "artrose") podem casualmente
   * gerar uma "code-like string". Por isso só tratamos como código quando a
   * primeira posição é alfabética e o restante é dígito (formato CID-10).
   */
  private normalizeCode(value: string): string {
    if (!value) return '';
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) return '';
    // CID-10 sempre começa com letra (A-Z) seguida de dígitos.
    if (!/^[A-Z]\d/.test(cleaned)) return '';
    return cleaned;
  }

  private normalizeText(value: string): string {
    return (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toResponse = (record: CidRecordInternal): CidResponse => ({
    id: record.id,
    code: record.code,
    description: record.description,
  });
}
