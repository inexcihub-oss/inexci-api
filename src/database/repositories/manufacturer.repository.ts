import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Manufacturer } from '../entities/manufacturer.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ManufacturerRepository extends BaseRepository<Manufacturer> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Manufacturer));
  }

  findMany(
    where: FindOptionsWhere<Manufacturer> | FindOptionsWhere<Manufacturer>[],
    skip?: number,
    take?: number,
  ): Promise<Manufacturer[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  findByOwnerId(ownerId: string): Promise<Manufacturer[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }
}
