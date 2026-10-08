import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, In } from 'typeorm';
import { ClinicalRecord } from '../entities/clinical-record.entity';
import { ProfessionalCouncil } from '../entities/doctor-profile.entity';
import { BaseRepository } from './base.repository';

/** Situação da ficha vinculada a uma consulta. */
export type ClinicalRecordStatus = 'draft' | 'finalized';

@Injectable()
export class ClinicalRecordRepository extends BaseRepository<ClinicalRecord> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicalRecord));
  }

  /**
   * Carrega o procedimento junto: a ficha (leitura, edição, finalização)
   * precisa do nome para exibir, sem obrigar cada chamador a buscá-lo à parte.
   */
  findOne(
    where: FindOptionsWhere<ClinicalRecord>,
  ): Promise<ClinicalRecord | null> {
    return this.repository.findOne({ where, relations: ['procedure'] });
  }

  /**
   * Situação da ficha de cada consulta (`draft` = em aberto, `finalized` =
   * finalizada). Consulta sem ficha viva fica fora do mapa.
   *
   * Seleção explícita de propósito: a agenda é liberada para quem só tem
   * `Permission.AGENDA`, e o que ela precisa saber é se há atendimento em
   * curso — nunca o conteúdo clínico. Ficha excluída (soft delete) não conta.
   */
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
    return (
      this.repository
        .createQueryBuilder('record')
        .where('record.surgicalIndication = true')
        .andWhere('record.surgeryRequestId IS NULL')
        .andWhere('record.finalizedAt IS NOT NULL')
        // Só quem pode indicar cirurgia (CRM com número e UF — o mesmo critério
        // de `assertIsPhysicianWithRegistry`). Ficha de quem não pode fica no
        // outbox sem ocupar o lote: senão 50 fichas bloqueadas travariam as novas.
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
        .getMany()
    );
  }

  /**
   * Clínica de origem de cada SC: a unidade da consulta cuja ficha indicou a
   * cirurgia. SC criada fora do atendimento não tem ficha e fica de fora.
   *
   * `withDeleted`: a SC continua tendo nascido naquela unidade mesmo depois de
   * a ficha ou a clínica serem excluídas — sumir com o vínculo faria a SC
   * escapar do filtro sem ninguém ter mexido nela.
   */
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
