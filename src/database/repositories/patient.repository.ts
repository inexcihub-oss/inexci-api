import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Patient } from '../entities/patient.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class PatientRepository extends BaseRepository<Patient> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Patient));
  }

  findMany(
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

  /**
   * Lista pacientes de um médico específico (paciente é do médico).
   */
  findByDoctorId(doctorId: string): Promise<Patient[]> {
    return this.repository.find({
      where: { doctorId },
      order: { name: 'ASC' },
    });
  }

  /**
   * Lista todos os pacientes da clínica (ownerId) — útil para visões de admin.
   */
  findByOwnerId(ownerId: string): Promise<Patient[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }
}
