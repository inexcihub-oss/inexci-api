import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppointmentActivity } from '../entities/appointment-activity.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class AppointmentActivityRepository extends BaseRepository<AppointmentActivity> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(AppointmentActivity));
  }

  /**
   * Linha do tempo da consulta, da mais antiga para a mais recente, com o nome
   * de quem fez — só id e nome: `User` tem CPF, telefone e endereço.
   */
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
