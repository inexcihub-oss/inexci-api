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

@Injectable()
export class CidService {
  constructor(
    @InjectRepository(Cid)
    private readonly cidRepository: Repository<Cid>,
  ) {}

  async findAll(query: FindManyCidDto) {
    const { search, skip = 0, take = 50 } = query;

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

    return {
      total,
      records: records.map((item) => ({
        id: item.id,
        code: item.code,
        description: item.description,
      })),
    };
  }
}
