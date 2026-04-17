import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaleNotificationLog } from '../entities/stale-notification-log.entity';

@Injectable()
export class StaleNotificationLogRepository {
  constructor(
    @InjectRepository(StaleNotificationLog)
    private readonly repository: Repository<StaleNotificationLog>,
  ) {}

  async hasBeenNotified(
    surgeryRequestId: string,
    staleDays: number,
  ): Promise<boolean> {
    const count = await this.repository.count({
      where: { surgery_request_id: surgeryRequestId, stale_days: staleDays },
    });
    return count > 0;
  }

  async record(
    surgeryRequestId: string,
    staleDays: number,
    channel: string,
  ): Promise<StaleNotificationLog> {
    return this.repository.save({
      surgery_request_id: surgeryRequestId,
      stale_days: staleDays,
      channel,
    });
  }

  async deleteByRequest(surgeryRequestId: string): Promise<void> {
    await this.repository.delete({ surgery_request_id: surgeryRequestId });
  }
}
