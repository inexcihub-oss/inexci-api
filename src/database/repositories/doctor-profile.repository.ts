import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { DoctorProfile } from '../entities/doctor-profile.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class DoctorProfileRepository extends BaseRepository<DoctorProfile> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(DoctorProfile));
  }

  async findOne(
    where: FindOptionsWhere<DoctorProfile>,
  ): Promise<DoctorProfile | null> {
    return this.repository.findOne({
      where,
      relations: ['user'],
    });
  }

  async findByUserId(userId: string): Promise<DoctorProfile | null> {
    return this.repository.findOne({
      where: { user_id: userId },
      relations: ['user'],
    });
  }

  async findMany(
    where: FindOptionsWhere<DoctorProfile> | FindOptionsWhere<DoctorProfile>[],
    skip?: number,
    take?: number,
  ): Promise<DoctorProfile[]> {
    return this.repository.find({
      where,
      skip,
      take,
      relations: ['user'],
      order: { id: 'DESC' },
    });
  }

  async existsByUserId(userId: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { user_id: userId },
    });
    return count > 0;
  }
}
