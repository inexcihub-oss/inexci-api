import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Tuss } from 'src/database/entities/tuss.entity';

export interface TussResponse {
  id: string;
  tuss_code: string;
  name: string;
  active: boolean;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutos

@Injectable()
export class TussService {
  private readonly cache = new Map<string, CacheEntry<TussResponse[]>>();

  constructor(
    @InjectRepository(Tuss)
    private readonly tussRepository: Repository<Tuss>,
  ) {}

  async search(search?: string, limit: number = 50): Promise<TussResponse[]> {
    const cacheKey = `tuss:${search ?? ''}:${limit}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const where: any[] = [];
    if (search && search.length >= 2) {
      where.push({ code: ILike(`%${search}%`) });
      where.push({ procedure: ILike(`%${search}%`) });
    }

    const records = await this.tussRepository.find({
      where: where.length > 0 ? where : undefined,
      take: limit,
      order: { code: 'ASC' },
    });

    const result = records.map((item) => ({
      id: item.id,
      tuss_code: this.formatTussCode(item.code),
      name: item.procedure,
      active: true,
    }));

    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }

  private formatTussCode(codigo: string): string {
    const str = codigo.padStart(10, '0');
    // Formato: XX.XX.XX.XXX-X
    return `${str.slice(0, 2)}.${str.slice(2, 4)}.${str.slice(4, 6)}.${str.slice(6, 9)}-${str.slice(9)}`;
  }
}
