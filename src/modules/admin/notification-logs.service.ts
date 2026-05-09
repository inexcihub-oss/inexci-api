import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  NotificationSendLog,
  NotificationChannel,
  NotificationSendStatus,
} from '../../database/entities/notification-send-log.entity';

export interface NotificationLogQuery {
  channel?: NotificationChannel;
  status?: NotificationSendStatus;
  ownerId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface NotificationLogStatsRow {
  channel: string;
  status: string;
  count: number;
}

@Injectable()
export class NotificationLogsService {
  constructor(
    @InjectRepository(NotificationSendLog)
    private readonly repo: Repository<NotificationSendLog>,
  ) {}

  /**
   * Lista paginada de logs (mais recentes primeiro). `body` e `errorMessage`
   * vêm do banco já truncados em VARCHAR(600). Default 50/página, máx 200.
   */
  async list(query: NotificationLogQuery): Promise<{
    items: NotificationSendLog[];
    total: number;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Record<string, any> = {};
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.from && query.to) {
      where.createdAt = Between(new Date(query.from), new Date(query.to));
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  /**
   * Estatísticas agregadas (count por channel/status) para o intervalo dado.
   * Útil para dashboards de saúde dos canais (e.g. % de falhas no WhatsApp
   * nas últimas 24h).
   */
  async stats(from?: string, to?: string): Promise<NotificationLogStatsRow[]> {
    const qb = this.repo
      .createQueryBuilder('l')
      .select('l.channel', 'channel')
      .addSelect('l.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('l.channel')
      .addGroupBy('l.status');

    if (from && to) {
      qb.where('l.created_at BETWEEN :from AND :to', {
        from: new Date(from),
        to: new Date(to),
      });
    }

    return qb.getRawMany<NotificationLogStatsRow>();
  }
}
