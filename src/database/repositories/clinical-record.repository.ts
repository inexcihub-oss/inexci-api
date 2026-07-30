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

  /**
   * Fichas finalizadas com indicação cirúrgica cuja SC ainda não foi criada —
   * a fila de trabalho do sweeper. Usa o índice parcial
   * `idx_clinical_records_indication_pending`; mais antigas primeiro, para que
   * uma falha persistente não deixe a mesma ficha esperando indefinidamente.
   */
  findPendingSurgicalIndications(limit: number): Promise<ClinicalRecord[]> {
    return this.repository
      .createQueryBuilder('record')
      .where('record.surgicalIndication = true')
      .andWhere('record.surgeryRequestId IS NULL')
      .andWhere('record.finalizedAt IS NOT NULL')
      .orderBy('record.finalizedAt', 'ASC')
      .take(limit)
      .getMany();
  }
}
