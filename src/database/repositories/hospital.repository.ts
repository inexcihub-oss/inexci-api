import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Hospital } from '../entities/hospital.entity';

@Injectable()
export class HospitalRepository {
  private repository: Repository<Hospital>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(Hospital);
  }

  async findOne(where: FindOptionsWhere<Hospital>): Promise<Hospital | null> {
    return this.repository.findOne({ where });
  }

  async findMany(
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

  async total(
    where: FindOptionsWhere<Hospital> | FindOptionsWhere<Hospital>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  async create(data: Partial<Hospital>): Promise<Hospital> {
    const hospital = this.repository.create(data);
    return this.repository.save(hospital);
  }

  async update(id: string, data: Partial<Hospital>): Promise<Hospital | null> {
    await this.repository.update(id, data);
    return this.findOne({ id });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async findByDoctorId(doctorId: string): Promise<Hospital[]> {
    return this.repository.find({
      where: { doctor_id: doctorId },
      order: { name: 'ASC' },
    });
  }
}
