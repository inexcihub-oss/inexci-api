import { Injectable } from '@nestjs/common';
import {
  NotificationSendLogFilter,
  NotificationSendLogRepository,
} from '../../database/repositories/notification-send-log.repository';
import {
  NotificationLogListResponseDto,
  NotificationLogsQueryDto,
  NotificationLogStatsRowDto,
  NotificationLogsStatsQueryDto,
} from './envios/dto/notification-logs.dto';
import { maskRecipient, sanitizeDeliveryError } from './envios/recipient-mask';
import { templateLabel } from './envios/template-label';

@Injectable()
export class NotificationLogsService {
  constructor(private readonly repository: NotificationSendLogRepository) {}

  async list(
    query: NotificationLogsQueryDto,
  ): Promise<NotificationLogListResponseDto> {
    const { items, total } = await this.repository.search({
      channel: query.channel,
      status: query.status,
      ownerId: query.ownerId,
      from: query.from,
      to: query.to,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        channel: row.channel,
        status: row.status,
        recipient: maskRecipient(row.to),
        template: row.template,
        templateLabel: templateLabel(row.template),
        notificationType: row.notificationType,
        direction: row.direction,
        attempts: row.attempts,
        error: sanitizeDeliveryError(row.errorMessage),
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        createdAt: row.createdAt,
        sentAt: row.sentAt,
      })),
      total,
    };
  }

  async stats(
    query: NotificationLogsStatsQueryDto,
  ): Promise<NotificationLogStatsRowDto[]> {
    const filter: NotificationSendLogFilter = {
      channel: query.channel,
      ownerId: query.ownerId,
      from: query.from,
      to: query.to,
    };
    return this.repository.stats(filter);
  }
}
