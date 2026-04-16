import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Procedure } from '../entities/procedure.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class ProcedureRepository extends BaseRepository<Procedure> {
  constructor(
    @InjectRepository(Procedure)
    repository: Repository<Procedure>,
  ) {
    super(repository);
  }

  async findMany(
    where: FindOptionsWhere<Procedure>,
    skip: number,
    take: number,
  ): Promise<Procedure[]> {
    return await this.repository.find({
      where,
      skip,
      take,
      select: {
        id: true,
        name: true,
      },
      order: { name: 'ASC' },
    });
  }

  async findOne(
    where: FindOptionsWhere<Procedure>,
  ): Promise<Procedure | null> {
    return await this.repository.findOne({
      where,
      select: {
        id: true,
        name: true,
      },
    });
  }
}
