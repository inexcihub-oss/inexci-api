import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DoctorSchedule } from '../entities/doctor-schedule.entity';
import { BaseRepository } from './base.repository';

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

  async hasAny(doctorId: string): Promise<boolean> {
    return (
      (await this.repository.count({ where: { doctorId, active: true } })) > 0
    );
  }
}
