import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ClinicalRecord } from '../entities/clinical-record.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicalRecordRepository extends BaseRepository<ClinicalRecord> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalRecord));
  }

  /**
   * Linha do tempo do paciente — mais recentes primeiro.
   *
   * Escopada por clínica e pelos médicos acessíveis: o prontuário é dado
   * clínico sensível (LGPD), então segue o mesmo recorte de
   * `AppointmentRepository.findByPatient`. Chamador passa a lista já resolvida.
   */
  findByPatientId(
    ownerId: string,
    doctorIds: string[],
    patientId: string,
  ): Promise<ClinicalRecord[]> {
    return this.repository.find({
      where: { ownerId, doctorId: In(doctorIds), patientId },
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
