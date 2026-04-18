import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Cid } from 'src/database/entities/cid.entity';
import { FindManyCidDto } from './dto/find-many-cid.controller.dto';

export interface CidResponse {
  id: string;
  code: string;
  description: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutos

@Injectable()
export class CidService {
  private readonly cache = new Map<string, CacheEntry<any>>();

  constructor(
    @InjectRepository(Cid)
    private readonly cidRepository: Repository<Cid>,
  ) {}

  async findAll(query: FindManyCidDto) {
    const { search, skip = 0, take = 50 } = query;
    const cacheKey = `cid:${search ?? ''}:${skip}:${take}`;

    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const where: any[] = [];
    if (search && search.length >= 2) {
      where.push({ code: ILike(`%${search}%`) });
      where.push({ description: ILike(`%${search}%`) });
    }

    const [records, total] = await this.cidRepository.findAndCount({
      where: where.length > 0 ? where : undefined,
      skip,
      take,
      order: { code: 'ASC' },
    });

    const result = {
      total,
      records: records.map((item) => ({
        id: item.id,
        code: item.code,
        description: item.description,
      })),
    };

    this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + TTL_MS });
    return result;
  }
}
