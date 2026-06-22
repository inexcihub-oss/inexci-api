import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, ILike } from 'typeorm';
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

  findByNameIncludingDeleted(
    ownerId: string,
    name: string,
  ): Promise<Manufacturer | null> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(null);

    return this.repository.findOne({
      where: { ownerId, name: ILike(trimmed) },
      withDeleted: true,
    });
  }
}
