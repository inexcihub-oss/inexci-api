import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, QueryDeepPartialEntity } from 'typeorm';
import { DoctorSchedule } from '../entities/doctor-schedule.entity';
import { BaseRepository } from './base.repository';

/** Operações da grade dentro da transação travada por profissional. */
export interface DoctorScheduleTx {
  findActiveByDoctor(doctorId: string): Promise<DoctorSchedule[]>;
  create(data: DeepPartial<DoctorSchedule>): Promise<DoctorSchedule>;
  update(
    id: string,
    data: DeepPartial<DoctorSchedule>,
  ): Promise<DoctorSchedule | null>;
}

@Injectable()
export class DoctorScheduleRepository extends BaseRepository<DoctorSchedule> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(DoctorSchedule));
  }

  /** Grades do profissional (ativas e inativas), por dia e horário. */
  findByDoctor(ownerId: string, doctorId: string): Promise<DoctorSchedule[]> {
    return this.repository.find({
      where: { ownerId, doctorId },
      relations: { room: true, clinic: true },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

  /** Grades ativas de um dia da semana, para expandir slots e checar a grade. */
  findActiveByDoctor(doctorId: string): Promise<DoctorSchedule[]> {
    return this.repository.find({
      where: { doctorId, active: true },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * Roda `fn` numa transação serializada por profissional
   * (`pg_advisory_xact_lock`): checar sobreposição e gravar viram uma coisa
   * só, e dois POSTs simultâneos do mesmo profissional não criam períodos
   * sobrepostos. A trava cai no commit/rollback.
   */
  comTravaDoProfissional<T>(
    doctorId: string,
    fn: (tx: DoctorScheduleTx) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `doctor_schedule:${doctorId}`,
      ]);
      const repo = manager.getRepository(DoctorSchedule);
      return fn({
        findActiveByDoctor: (id) =>
          repo.find({
            where: { doctorId: id, active: true },
            order: { weekday: 'ASC', startTime: 'ASC' },
          }),
        create: (data) => repo.save(repo.create(data)),
        update: async (id, data) => {
          await repo.update(id, data as QueryDeepPartialEntity<DoctorSchedule>);
          return repo.findOne({ where: { id } });
        },
      });
    });
  }

  async hasAny(doctorId: string): Promise<boolean> {
    return (
      (await this.repository.count({ where: { doctorId, active: true } })) > 0
    );
  }
}
