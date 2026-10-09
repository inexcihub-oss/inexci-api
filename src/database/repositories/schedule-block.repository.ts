import { Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { ScheduleBlock } from '../entities/schedule-block.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ScheduleBlockRepository extends BaseRepository<ScheduleBlock> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ScheduleBlock));
  }

  findInRange(
    ownerId: string,
    from: Date,
    to: Date,
    doctorIds?: string[],
  ): Promise<ScheduleBlock[]> {
    const qb = this.repository
      .createQueryBuilder('b')
      .where('b.ownerId = :ownerId', { ownerId })
      .andWhere('b.startsAt < :to', { to })
      .andWhere('b.endsAt > :from', { from });
    if (doctorIds) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('b.doctorId IS NULL');
          if (doctorIds.length)
            w.orWhere('b.doctorId IN (:...doctorIds)', { doctorIds });
        }),
      );
    }
    return qb.orderBy('b.startsAt', 'ASC').getMany();
  }
}
