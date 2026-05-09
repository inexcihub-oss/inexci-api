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

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 hora (dados estáticos)

@Injectable()
export class CidService {
  private readonly cache = new Map<string, CacheEntry<any>>();
  private allRecords: CidResponse[] | null = null;

  private loadAll(): CidResponse[] {
    if (this.allRecords) return this.allRecords;

    const filePath = path.join(process.cwd(), 'src', 'utils', 'cid.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json: { rows: CidJsonRow[] } = JSON.parse(raw);

    this.allRecords = json.rows.map((row) => ({
      id: row.codigo,
      code: row.codigo,
      description: row.descricao,
    }));

    return this.allRecords;
  }

  findAll(query: FindManyCidDto) {
    const { search, skip = 0, take = 50 } = query;
    const cacheKey = `cid:${search ?? ''}:${skip}:${take}`;

    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const all = this.loadAll();

    let filtered = all;
    if (search && search.length >= 2) {
      const lower = search.toLowerCase();
      filtered = all.filter(
        (item) =>
          item.code.toLowerCase().includes(lower) ||
          item.description.toLowerCase().includes(lower),
      );
    }

    const total = filtered.length;
    const records = filtered.slice(skip, skip + take);

    const result = { total, records };
    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }
}
