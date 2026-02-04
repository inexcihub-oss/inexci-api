import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { DoctorProfile } from '../entities/doctor-profile.entity';

@Injectable()
export class DoctorProfileRepository {
  private repository: Repository<DoctorProfile>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(DoctorProfile);
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

  async total(
    where: FindOptionsWhere<DoctorProfile> | FindOptionsWhere<DoctorProfile>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  async create(data: Partial<DoctorProfile>): Promise<DoctorProfile> {
    const profile = this.repository.create(data);
    return this.repository.save(profile);
  }

  async update(
    id: string,
    data: Partial<DoctorProfile>,
  ): Promise<DoctorProfile | null> {
    await this.repository.update(id, data);
    return this.findOne({ id });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
