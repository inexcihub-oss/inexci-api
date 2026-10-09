import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppointmentActivity } from '../entities/appointment-activity.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AppointmentActivityRepository extends BaseRepository<AppointmentActivity> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(AppointmentActivity));
  }

  findByAppointment(appointmentId: string): Promise<AppointmentActivity[]> {
    return this.repository
      .createQueryBuilder('activity')
      .leftJoin('activity.user', 'user')
      .addSelect(['user.id', 'user.name'])
      .where('activity.appointmentId = :appointmentId', { appointmentId })
      .orderBy('activity.createdAt', 'ASC')
      .getMany();
  }
}
