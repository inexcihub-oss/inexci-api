import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
  OCCUPYING_APPOINTMENT_STATUSES,
} from '../entities/appointment.entity';
import { BaseRepository } from './base.repository';

export interface FindAgendaOptions {
  from?: Date;
  to?: Date;
  statuses?: AppointmentStatus[];
  order?: 'ASC' | 'DESC';
  take: number;
  skip?: number;
}

const COLUNAS_PACIENTE_NO_CARD = ['patient.id', 'patient.name'];

const COLUNAS_CLINICA_NO_CARD = ['clinic.id', 'clinic.name'];

const COLUNAS_EXTRAS_NO_CARD = [
  'room.id',
  'room.name',
  'healthPlan.id',
  'healthPlan.name',
  'createdBy.id',
  'createdBy.name',
];

const COLUNAS_CLINICA_NO_AVISO = [
  'clinic.id',
  'clinic.name',
  'clinic.address',
  'clinic.addressNumber',
  'clinic.neighborhood',
  'clinic.city',
  'clinic.state',
];

@Injectable()
export class AppointmentRepository extends BaseRepository<Appointment> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Appointment));
  }

  async findAgenda(
    ownerId: string,
    doctorIds: string[],
    options: FindAgendaOptions,
  ): Promise<{ records: Appointment[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('appointment')
      .withDeleted()
      .leftJoin('appointment.patient', 'patient', 'patient.deleted_at IS NULL')
      .addSelect(COLUNAS_PACIENTE_NO_CARD)
      .leftJoin('appointment.clinic', 'clinic')
      .addSelect(COLUNAS_CLINICA_NO_CARD)
      .leftJoin('appointment.room', 'room')
      .leftJoin('appointment.healthPlan', 'healthPlan')
      .leftJoin('appointment.createdBy', 'createdBy')
      .addSelect(COLUNAS_EXTRAS_NO_CARD)
      .where('appointment.ownerId = :ownerId', { ownerId })
      .andWhere('appointment.doctorId IN (:...doctorIds)', { doctorIds })
      .andWhere('appointment.deletedAt IS NULL');

    if (options.from) {
      qb.andWhere('appointment.scheduledAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('appointment.scheduledAt < :to', { to: options.to });
    }
    if (options.statuses?.length) {
      qb.andWhere('appointment.status IN (:...statuses)', {
        statuses: options.statuses,
      });
    }

    const [records, total] = await qb
      .orderBy('appointment.scheduledAt', options.order ?? 'ASC')
      .addOrderBy('appointment.id', 'ASC')
      .skip(options.skip ?? 0)
      .take(options.take)
      .getManyAndCount();

    return { records, total };
  }

  async countByDoctor(
    ownerId: string,
    doctorIds: string[],
    options: Omit<FindAgendaOptions, 'take' | 'skip' | 'order'>,
  ): Promise<Record<string, number>> {
    const qb = this.repository
      .createQueryBuilder('appointment')
      .select('appointment.doctorId', 'doctorId')
      .addSelect('COUNT(*)::int', 'total')
      .where('appointment.ownerId = :ownerId', { ownerId })
      .andWhere('appointment.doctorId IN (:...doctorIds)', { doctorIds });
    if (options.from) {
      qb.andWhere('appointment.scheduledAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('appointment.scheduledAt < :to', { to: options.to });
    }
    if (options.statuses?.length) {
      qb.andWhere('appointment.status IN (:...statuses)', {
        statuses: options.statuses,
      });
    }
    const linhas: { doctorId: string; total: number }[] = await qb
      .groupBy('appointment.doctorId')
      .getRawMany();
    return Object.fromEntries(linhas.map((l) => [l.doctorId, Number(l.total)]));
  }

  findByPatient(
    ownerId: string,
    doctorIds: string[],
    patientId: string,
  ): Promise<Appointment[]> {
    return this.repository
      .createQueryBuilder('appointment')
      .withDeleted()
      .leftJoin('appointment.patient', 'patient', 'patient.deleted_at IS NULL')
      .addSelect(COLUNAS_PACIENTE_NO_CARD)
      .leftJoin('appointment.clinic', 'clinic')
      .addSelect(COLUNAS_CLINICA_NO_CARD)
      .leftJoin('appointment.room', 'room')
      .leftJoin('appointment.healthPlan', 'healthPlan')
      .leftJoin('appointment.createdBy', 'createdBy')
      .addSelect(COLUNAS_EXTRAS_NO_CARD)
      .where('appointment.ownerId = :ownerId', { ownerId })
      .andWhere('appointment.doctorId IN (:...doctorIds)', { doctorIds })
      .andWhere('appointment.patientId = :patientId', { patientId })
      .andWhere('appointment.deletedAt IS NULL')
      .orderBy('appointment.scheduledAt', 'DESC')
      .getMany();
  }

  findOneComRelacoes(id: string): Promise<Appointment | null> {
    return this.repository
      .createQueryBuilder('appointment')
      .withDeleted()
      .leftJoin('appointment.patient', 'patient', 'patient.deleted_at IS NULL')
      .addSelect(COLUNAS_PACIENTE_NO_CARD)
      .leftJoin('appointment.clinic', 'clinic')
      .addSelect(COLUNAS_CLINICA_NO_CARD)
      .leftJoin('appointment.room', 'room')
      .leftJoin('appointment.healthPlan', 'healthPlan')
      .leftJoin('appointment.createdBy', 'createdBy')
      .addSelect(COLUNAS_EXTRAS_NO_CARD)
      .where('appointment.id = :id', { id })
      .andWhere('appointment.deletedAt IS NULL')
      .getOne();
  }

  findAtivaPorTelefone(
    phoneDigits: string[],
    janela: { from: Date; to: Date },
  ): Promise<Appointment | null> {
    if (!phoneDigits.length) return Promise.resolve(null);

    return this.repository
      .createQueryBuilder('appointment')
      .innerJoin('appointment.patient', 'patient', 'patient.deleted_at IS NULL')
      .addSelect(COLUNAS_PACIENTE_NO_CARD)
      .leftJoin('appointment.clinic', 'clinic')
      .addSelect(COLUNAS_CLINICA_NO_AVISO)
      .where(
        "regexp_replace(patient.phone, '[^0-9]', '', 'g') IN (:...phones)",
        { phones: phoneDigits },
      )
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
      })
      .andWhere('appointment.scheduledAt >= :from', { from: janela.from })
      .andWhere('appointment.scheduledAt < :to', { to: janela.to })
      .andWhere('appointment.deletedAt IS NULL')
      .orderBy('appointment.reminderSentAt', 'DESC', 'NULLS LAST')
      .addOrderBy('appointment.scheduledAt', 'ASC')
      .getOne();
  }

  async hasOverlap(
    doctorId: string,
    start: Date,
    end: Date,
    excludeId?: string,
    opcoes: { ignorarEncaixes?: boolean } = {},
  ): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('appointment')
      .where('appointment.doctorId = :doctorId', { doctorId })
      .andWhere('appointment.status IN (:...ocupam)', {
        ocupam: OCCUPYING_APPOINTMENT_STATUSES,
      })
      .andWhere('appointment.scheduledAt < :end', { end })
      .andWhere(
        `appointment.scheduledAt + (appointment.durationMinutes * interval '1 minute') > :start`,
        { start },
      );

    if (excludeId) {
      qb.andWhere('appointment.id != :excludeId', { excludeId });
    }
    if (opcoes.ignorarEncaixes) {
      qb.andWhere('appointment.isWalkIn = false');
    }

    const count = await qb.getCount();
    return count > 0;
  }

  findOcupando(doctorId: string, from: Date, to: Date): Promise<Appointment[]> {
    return this.repository
      .createQueryBuilder('appointment')
      .select([
        'appointment.id',
        'appointment.scheduledAt',
        'appointment.durationMinutes',
      ])
      .where('appointment.doctorId = :doctorId', { doctorId })
      .andWhere('appointment.status IN (:...ocupam)', {
        ocupam: OCCUPYING_APPOINTMENT_STATUSES,
      })
      .andWhere('appointment.scheduledAt < :to', { to })
      .andWhere(
        `appointment.scheduledAt + (appointment.durationMinutes * interval '1 minute') > :from`,
        { from },
      )
      .orderBy('appointment.scheduledAt', 'ASC')
      .getMany();
  }

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
