import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { Cid } from '../entities/cid.entity';

@Global()
@Injectable()
export class CidRepository {
  constructor(
    @InjectRepository(Cid)
    private readonly repository: Repository<Cid>,
  ) {}

  async total(
    where: FindOptionsWhere<Cid> | FindOptionsWhere<Cid>[],
  ): Promise<number> {
    return await this.repository.count({ where });
  }

  async findMany(
    where: FindOptionsWhere<Cid> | FindOptionsWhere<Cid>[],
    skip: number,
    take: number,
  ): Promise<Cid[]> {
    return await this.repository.find({
      where,
      skip,
      take,
    });
  }
}
