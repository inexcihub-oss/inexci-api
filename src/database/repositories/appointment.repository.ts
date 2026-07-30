import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Appointment } from '../entities/appointment.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AppointmentRepository extends BaseRepository<Appointment> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Appointment));
  }

  /**
   * Consultas de um conjunto de médicos com início dentro do intervalo visível
   * da agenda. Traz o paciente para montar o card sem N+1.
   */
  findAgenda(
    doctorIds: string[],
    from: Date,
    to: Date,
    take: number,
  ): Promise<Appointment[]> {
    return this.repository
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .where('appointment.doctorId IN (:...doctorIds)', { doctorIds })
      .andWhere('appointment.scheduledAt BETWEEN :from AND :to', { from, to })
      .orderBy('appointment.scheduledAt', 'ASC')
      .take(take)
      .getMany();
  }

  /**
   * Histórico completo de consultas de um paciente (sem janela de data),
   * escopado aos médicos acessíveis. Alimenta a aba "Consultas" e a timeline.
   */
  findByPatient(
    doctorIds: string[],
    patientId: string,
  ): Promise<Appointment[]> {
    return this.repository
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .where('appointment.doctorId IN (:...doctorIds)', { doctorIds })
      .andWhere('appointment.patientId = :patientId', { patientId })
      .orderBy('appointment.scheduledAt', 'DESC')
      .getMany();
  }

  /**
   * Detecta conflito de horário para um médico: uma consulta ativa (não
   * cancelada) cujo intervalo [scheduled_at, scheduled_at + duração) sobrepõe
   * [start, end). `excludeId` ignora a própria consulta ao reagendar.
   */
  async hasOverlap(
    doctorId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('appointment')
      .where('appointment.doctorId = :doctorId', { doctorId })
      .andWhere('appointment.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('appointment.scheduledAt < :end', { end })
      .andWhere(
        `appointment.scheduledAt + (appointment.durationMinutes * interval '1 minute') > :start`,
        { start },
      );

    if (excludeId) {
      qb.andWhere('appointment.id != :excludeId', { excludeId });
    }

    const count = await qb.getCount();
    return count > 0;
  }

  /**
   * Consultas ativas (agendada/confirmada) que começam na janela [now, until]
   * e ainda não tiveram lembrete enviado. Base do lembrete automático de 24h.
   */
  findDueForReminder(now: Date, until: Date): Promise<Appointment[]> {
    return this.repository
      .createQueryBuilder('appointment')
      .where('appointment.reminderSentAt IS NULL')
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: ['scheduled', 'confirmed'],
      })
      .andWhere('appointment.scheduledAt BETWEEN :now AND :until', {
        now,
        until,
      })
      .orderBy('appointment.scheduledAt', 'ASC')
      .getMany();
  }
}
