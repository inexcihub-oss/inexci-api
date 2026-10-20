import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, In } from 'typeorm';
import { ClinicalRecord } from '../entities/clinical-record.entity';
import { ProfessionalCouncil } from '../entities/doctor-profile.entity';
import { BaseRepository } from './base.repository';

export type ClinicalRecordStatus = 'draft' | 'finalized';

@Injectable()
export class ClinicalRecordRepository extends BaseRepository<ClinicalRecord> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalRecord));
  }

  findOne(
    where: FindOptionsWhere<ClinicalRecord>,
  ): Promise<ClinicalRecord | null> {
    return this.repository.findOne({ where, relations: ['procedure'] });
  }

  async findStatusByAppointmentIds(
    appointmentIds: string[],
  ): Promise<Map<string, ClinicalRecordStatus>> {
    const mapa = new Map<string, ClinicalRecordStatus>();
    if (!appointmentIds.length) return mapa;
    const fichas = await this.repository.find({
      select: { id: true, appointmentId: true, finalizedAt: true },
      where: { appointmentId: In(appointmentIds) },
    });
    for (const f of fichas) {
      if (f.appointmentId) {
        mapa.set(f.appointmentId, f.finalizedAt ? 'finalized' : 'draft');
      }
    }
    return mapa;
  }

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

  findPendingSurgicalIndications(limit: number): Promise<ClinicalRecord[]> {
    return this.repository
      .createQueryBuilder('record')
      .where('record.surgicalIndication = true')
      .andWhere('record.surgeryRequestId IS NULL')
      .andWhere('record.finalizedAt IS NOT NULL')
      .andWhere(
        `EXISTS (
           SELECT 1 FROM doctor_profiles dp
            WHERE dp.user_id = record.doctor_id
              AND dp.council = :crm
              AND NULLIF(TRIM(dp.crm), '') IS NOT NULL
              AND NULLIF(TRIM(dp.crm_state), '') IS NOT NULL
         )`,
        { crm: ProfessionalCouncil.CRM },
      )
      .orderBy('record.finalizedAt', 'ASC')
      .take(limit)
      .getMany();
  }

  findClinicsBySurgeryRequestIds(
    requestIds: string[],
  ): Promise<
    Array<{ surgeryRequestId: string; clinicId: string; clinicName: string }>
  > {
    if (requestIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('record')
      .withDeleted()
      .innerJoin('record.appointment', 'appointment')
      .innerJoin('appointment.clinic', 'clinic')
      .where('record.surgeryRequestId IN (:...requestIds)', { requestIds })
      .select('record.surgeryRequestId', 'surgeryRequestId')
      .addSelect('clinic.id', 'clinicId')
      .addSelect('clinic.name', 'clinicName')
      .orderBy('record.createdAt', 'ASC')
      .getRawMany();
  }
}
