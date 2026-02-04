import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Patient } from '../entities/patient.entity';

@Injectable()
export class PatientRepository {
  private repository: Repository<Patient>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(Patient);
  }

  async findOne(where: FindOptionsWhere<Patient>): Promise<Patient | null> {
    return this.repository.findOne({ where });
  }

  async findMany(
    where: FindOptionsWhere<Patient> | FindOptionsWhere<Patient>[],
    skip?: number,
    take?: number,
  ): Promise<Patient[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  async total(
    where: FindOptionsWhere<Patient> | FindOptionsWhere<Patient>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  async create(data: Partial<Patient>): Promise<Patient> {
    const patient = this.repository.create(data);
    return this.repository.save(patient);
  }

  async update(id: number, data: Partial<Patient>): Promise<Patient | null> {
    await this.repository.update(id, data);
    return this.findOne({ id });
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  async findByDoctorId(doctorId: number): Promise<Patient[]> {
    return this.repository.find({
      where: { doctor_id: doctorId },
      order: { name: 'ASC' },
    });
  }
}
