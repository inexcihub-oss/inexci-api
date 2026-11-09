import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  NotificationChannel,
  NotificationSendLog,
  NotificationSendStatus,
} from '../entities/notification-send-log.entity';
import { User } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

export interface NotificationSendLogFilter {
  channel?: NotificationChannel;
  status?: NotificationSendStatus;
  ownerId?: string;
  from?: Date;
  to?: Date;
}

export interface NotificationSendLogPageFilter extends NotificationSendLogFilter {
  limit: number;
  offset: number;
}

export interface NotificationSendLogRow {
  id: string;
  channel: NotificationChannel;
  status: NotificationSendStatus;
  to: string;
  template: string | null;
  notificationType: string | null;
  direction: string | null;
  attempts: number;
  errorMessage: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface NotificationSendLogStatsRow {
  channel: NotificationChannel;
  status: NotificationSendStatus;
  count: number;
}

@Injectable()
export class NotificationSendLogRepository extends BaseRepository<NotificationSendLog> {
  constructor(
    @InjectRepository(NotificationSendLog)
    repository: Repository<NotificationSendLog>,
  ) {
    super(repository);
  }

  private applyFilter(
    qb: SelectQueryBuilder<NotificationSendLog>,
    filter: NotificationSendLogFilter,
  ): void {
    if (filter.channel) {
      qb.andWhere('l.channel = :channel', { channel: filter.channel });
    }
    if (filter.status) {
      qb.andWhere('l.status = :status', { status: filter.status });
    }
    if (filter.ownerId) {
      qb.andWhere('l.owner_id = :ownerId', { ownerId: filter.ownerId });
    }
    if (filter.from) {
      qb.andWhere('l.created_at >= :from', { from: filter.from });
    }
    if (filter.to) {
      qb.andWhere('l.created_at < :to', { to: filter.to });
    }
  }

  async search(
    filter: NotificationSendLogPageFilter,
  ): Promise<{ items: NotificationSendLogRow[]; total: number }> {
    const countQb = this.repository.createQueryBuilder('l');
    this.applyFilter(countQb, filter);
    const total = await countQb.getCount();

    const qb = this.repository
      .createQueryBuilder('l')
      .leftJoin(User, 'o', 'o.id = l.owner_id')
      .select('l.id', 'id')
      .addSelect('l.channel', 'channel')
      .addSelect('l.status', 'status')
      .addSelect('l.to', 'to')
      .addSelect('l.template', 'template')
      .addSelect('l.notification_type', 'notificationType')
      .addSelect('l.direction', 'direction')
      .addSelect('l.attempts', 'attempts')
      .addSelect('l.error_message', 'errorMessage')
      .addSelect('l.owner_id', 'ownerId')
      .addSelect('o.name', 'ownerName')
      .addSelect('l.created_at', 'createdAt')
      .addSelect('l.sent_at', 'sentAt');
    this.applyFilter(qb, filter);

    const items = await qb
      .orderBy('l.created_at', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .offset(filter.offset)
      .limit(filter.limit)
      .getRawMany<NotificationSendLogRow>();

    return { items, total };
  }

  async stats(
    filter: NotificationSendLogFilter,
  ): Promise<NotificationSendLogStatsRow[]> {
    const qb = this.repository
      .createQueryBuilder('l')
      .select('l.channel', 'channel')
      .addSelect('l.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('l.channel')
      .addGroupBy('l.status');
    this.applyFilter(qb, filter);
    return qb.getRawMany<NotificationSendLogStatsRow>();
  }
}
