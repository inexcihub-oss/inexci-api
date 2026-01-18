import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { Procedure } from '../entities/procedure.entity';

@Global()
@Injectable()
export class ProcedureRepository {
  constructor(
    @InjectRepository(Procedure)
    private readonly repository: Repository<Procedure>,
  ) {}

  async total(where: FindOptionsWhere<Procedure>): Promise<number> {
    return await this.repository.count({ where });
  }

  async findMany(
    where: FindOptionsWhere<Procedure>,
    skip: number,
    take: number,
  ): Promise<Partial<Procedure>[]> {
    return await this.repository.find({
      where,
      skip,
      take,
      select: {
        id: true,
        tuss_code: true,
        name: true,
      },
      order: { tuss_code: 'ASC' },
    });
  }

  async findOne(
    where: FindOptionsWhere<Procedure>,
  ): Promise<Partial<Procedure> | null> {
    return await this.repository.findOne({
      where,
      select: {
        id: true,
        tuss_code: true,
        name: true,
      },
    });
  }
}
