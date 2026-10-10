import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaleNotificationLog } from '../entities/stale-notification-log.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class StaleNotificationLogRepository extends BaseRepository<StaleNotificationLog> {
  constructor(
    @InjectRepository(StaleNotificationLog)
    repository: Repository<StaleNotificationLog>,
  ) {
    super(repository);
  }

  async hasBeenNotified(
    surgeryRequestId: string,
    staleDays: number,
  ): Promise<boolean> {
    const count = await this.repository.count({
      where: { surgeryRequestId, staleDays },
    });
    return count > 0;
  }

  record(
    surgeryRequestId: string,
    staleDays: number,
    channel: string,
  ): Promise<StaleNotificationLog> {
    return this.repository.save({
      surgeryRequestId,
      staleDays,
      channel,
    });
  }
}
