import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Hospital } from '../entities/hospital.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class HospitalRepository extends BaseRepository<Hospital> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Hospital));
  }

  findMany(
    where: FindOptionsWhere<Hospital> | FindOptionsWhere<Hospital>[],
    skip?: number,
    take?: number,
  ): Promise<Hospital[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  findByDoctorId(doctorId: string): Promise<Hospital[]> {
    return this.repository.find({
      where: { doctor_id: doctorId },
      order: { name: 'ASC' },
    });
  }
}
