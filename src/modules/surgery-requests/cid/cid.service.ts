import { Injectable } from '@nestjs/common';
import { FindManyCidDto } from './dto/find-many-cid.controller.dto';
import { FindOptionsWhere, Like } from 'typeorm';
import { CidRepository } from 'src/database/repositories/cid.repository';
import { Cid } from 'src/database/entities/cid.entity';

@Injectable()
export class CidService {
  constructor(private readonly cidRepository: CidRepository) {}
  async findAll(query: FindManyCidDto) {
    const { search, skip, take } = query;

    // TypeORM usa array de FindOptionsWhere para OR
    const where: FindOptionsWhere<Cid>[] = search
      ? [{ id: Like(`%${search}%`) }, { description: Like(`%${search}%`) }]
      : [];

    const [total, records] = await Promise.all([
      this.cidRepository.total(where),
      this.cidRepository.findMany(where, skip || 0, take || 10),
    ]);

    return { total, records };
  }
}
