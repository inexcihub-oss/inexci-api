import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, QueryDeepPartialEntity } from 'typeorm';
import { DoctorSchedule } from '../entities/doctor-schedule.entity';
import { BaseRepository } from './base.repository';

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

  findByDoctor(ownerId: string, doctorId: string): Promise<DoctorSchedule[]> {
    return this.repository.find({
      where: { ownerId, doctorId },
      relations: { room: true, clinic: true },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

  findActiveByDoctor(doctorId: string): Promise<DoctorSchedule[]> {
    return this.repository.find({
      where: { doctorId, active: true },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

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
}
