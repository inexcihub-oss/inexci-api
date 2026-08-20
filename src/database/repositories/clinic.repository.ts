import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Clinic } from '../entities/clinic.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicRepository extends BaseRepository<Clinic> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Clinic));
  }

  findMany(
    where: FindOptionsWhere<Clinic> | FindOptionsWhere<Clinic>[],
    skip?: number,
    take?: number,
  ): Promise<Clinic[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  /** Clínicas cadastradas pela conta (ownerId). */
  findByOwnerId(ownerId: string): Promise<Clinic[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }
}
