import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

export interface TussResponse {
  id: string;
  tussCode: string;
  name: string;
  active: boolean;
}

interface TussJsonRow {
  codigo: number | string;
  procedimento: string;
}

interface TussRecordInternal extends TussResponse {
  digits: string;
  nameNormalized: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000;

@Injectable()
export class TussService {
  private readonly cache = new Map<string, CacheEntry<TussResponse[]>>();
  private allRecords: TussRecordInternal[] | null = null;

  private loadAll(): TussRecordInternal[] {
    if (this.allRecords) return this.allRecords;

    const filePath = path.join(process.cwd(), 'src', 'utils', 'tuss.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json: { rows: TussJsonRow[] } = JSON.parse(raw);

    this.allRecords = json.rows.map((row) => {
      const digits = String(row.codigo).replace(/\D/g, '').padStart(10, '0');
      return {
        id: digits,
        tussCode: this.formatTussCode(digits),
        name: row.procedimento,
        active: true,
        digits,
        nameNormalized: this.normalizeText(row.procedimento),
      };
    });

    return this.allRecords;
  }

  search(search?: string, limit: number = 50): TussResponse[] {
    const cacheKey = `tuss:search:${search ?? ''}:${limit}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const all = this.loadAll();

    let filtered: TussRecordInternal[] = all;
    if (search && search.trim().length >= 2) {
      filtered = this.rankMatches(all, search);
    }

    const result: TussResponse[] = filtered
      .slice(0, limit)
      .map(this.toResponse);
    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }

  lookup(query: string, limit: number = 10): TussResponse[] {
    const trimmed = (query ?? '').trim();
    if (!trimmed) return [];

    const cacheKey = `tuss:lookup:${trimmed.toLowerCase()}:${limit}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const all = this.loadAll();
    const ranked = this.rankMatches(all, trimmed).slice(0, limit);
    const result = ranked.map(this.toResponse);

    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }

  findByExactCode(code: string): TussResponse | null {
    const digits = (code ?? '').replace(/\D/g, '');
    if (!digits) return null;

    const padded = digits.padStart(10, '0');
    const all = this.loadAll();
    const match = all.find((item) => item.digits === padded);
    return match ? this.toResponse(match) : null;
  }

  private rankMatches(
    records: TussRecordInternal[],
    rawQuery: string,
  ): TussRecordInternal[] {
    const queryDigits = rawQuery.replace(/\D/g, '');
    const queryNormalized = this.normalizeText(rawQuery);
    const queryTokens = queryNormalized.split(/\s+/).filter(Boolean);

    if (!queryDigits && queryTokens.length === 0) return [];

    const scored: Array<{ record: TussRecordInternal; score: number }> = [];

    for (const record of records) {
      const score = this.scoreRecord(
        record,
        queryDigits,
        queryNormalized,
        queryTokens,
      );
      if (score > 0) scored.push({ record, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.record.digits.localeCompare(b.record.digits);
    });

    return scored.map((entry) => entry.record);
  }

  private scoreRecord(
    record: TussRecordInternal,
    queryDigits: string,
    queryNormalized: string,
    queryTokens: string[],
  ): number {
    let score = 0;

    if (queryDigits) {
      if (record.digits === queryDigits.padStart(10, '0')) {
        score += 1000;
      } else if (record.digits.startsWith(queryDigits)) {
        score += 600;
      } else if (record.digits.includes(queryDigits)) {
        score += 300;
      }
    }

    if (queryTokens.length > 0) {
      const exactMatch = record.nameNormalized === queryNormalized;
      const startsWithQuery = record.nameNormalized.startsWith(queryNormalized);
      const containsQuery =
        queryNormalized.length > 0 &&
        record.nameNormalized.includes(queryNormalized);

      if (exactMatch) {
        score += 800;
      } else if (startsWithQuery) {
        score += 400;
      } else if (containsQuery) {
        score += 200;
      }

      if (queryTokens.length > 1) {
        const allTokensMatch = queryTokens.every((token) =>
          record.nameNormalized.includes(token),
        );
        if (allTokensMatch && !containsQuery) score += 150;
      }
    }

    return score;
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

  private formatTussCode(codigo: string): string {
    const str = codigo.padStart(10, '0');
    return `${str.slice(0, 2)}.${str.slice(2, 4)}.${str.slice(4, 6)}.${str.slice(6, 9)}-${str.slice(9)}`;
  }

  private toResponse = (record: TussRecordInternal): TussResponse => ({
    id: record.id,
    tussCode: record.tussCode,
    name: record.name,
    active: record.active,
  });
}
