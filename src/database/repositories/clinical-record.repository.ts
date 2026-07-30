import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClinicalRecord } from '../entities/clinical-record.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicalRecordRepository extends BaseRepository<ClinicalRecord> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalRecord));
  }

  /** Linha do tempo do paciente — mais recentes primeiro. */
  findByPatientId(patientId: string): Promise<ClinicalRecord[]> {
    return this.repository.find({
      where: { patientId },
      order: { createdAt: 'DESC' },
    });
  }
}
