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

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 hora (dados estáticos)

@Injectable()
export class TussService {
  private readonly cache = new Map<string, CacheEntry<TussResponse[]>>();
  private allRecords: TussResponse[] | null = null;

  private loadAll(): TussResponse[] {
    if (this.allRecords) return this.allRecords;

    const filePath = path.join(process.cwd(), 'src', 'utils', 'tuss.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json: { rows: TussJsonRow[] } = JSON.parse(raw);

    this.allRecords = json.rows.map((row) => {
      const code = String(row.codigo);
      return {
        id: code,
        tussCode: this.formatTussCode(code),
        name: row.procedimento,
        active: true,
      };
    });

    return this.allRecords;
  }

  search(search?: string, limit: number = 50): TussResponse[] {
    const cacheKey = `tuss:${search ?? ''}:${limit}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const all = this.loadAll();

    let filtered = all;
    if (search && search.length >= 2) {
      const lower = search.toLowerCase();
      filtered = all.filter(
        (item) =>
          item.tussCode.toLowerCase().includes(lower) ||
          item.name.toLowerCase().includes(lower) ||
          item.id.includes(search),
      );
    }

    const result = filtered.slice(0, limit);
    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }

  private formatTussCode(codigo: string): string {
    const str = codigo.padStart(10, '0');
    return `${str.slice(0, 2)}.${str.slice(2, 4)}.${str.slice(4, 6)}.${str.slice(6, 9)}-${str.slice(9)}`;
  }
}
