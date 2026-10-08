import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Holiday } from '../entities/holiday.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class HolidayRepository extends BaseRepository<Holiday> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Holiday));
  }

  /** Todos os feriados da conta; quem filtra por ano/recorrência é o service. */
  findByOwner(ownerId: string): Promise<Holiday[]> {
    return this.repository.find({
      where: { ownerId },
      order: { date: 'ASC' },
    });
  }
}
