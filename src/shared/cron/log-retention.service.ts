import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { AiTokenUsageLog } from 'src/database/entities/ai-token-usage-log.entity';
import { AiPiiRedactionLog } from 'src/database/entities/ai-pii-redaction-log.entity';
import { StaleNotificationLog } from 'src/database/entities/stale-notification-log.entity';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { errorMessage } from 'src/shared/utils/error-message.util';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class LogRetentionService {
  private readonly logger = new Logger(LogRetentionService.name);

  constructor(
    @InjectRepository(NotificationSendLog)
    private readonly notificationSendLogRepo: Repository<NotificationSendLog>,
    @InjectRepository(AiTokenUsageLog)
    private readonly aiTokenUsageLogRepo: Repository<AiTokenUsageLog>,
    @InjectRepository(AiPiiRedactionLog)
    private readonly aiPiiRedactionLogRepo: Repository<AiPiiRedactionLog>,
    @InjectRepository(StaleNotificationLog)
    private readonly staleNotificationLogRepo: Repository<StaleNotificationLog>,
    private readonly notificationRepository: NotificationRepository,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDaily(): Promise<void> {
    this.logger.log('[LogRetention] início do ciclo diário');

    const summary = {
      notificationSendLogs: 0,
      aiTokenUsageLogs: 0,
      aiPiiRedactionLogs: 0,
      staleNotificationLogs: 0,
      readNotifications: 0,
    };

    summary.notificationSendLogs = await this.purge(
      'notification_send_logs',
      this.notificationSendLogRepo,
      'createdAt',
      this.config.get<number>('LOG_RETENTION_NOTIFICATION_DAYS', 90),
    );

    summary.aiTokenUsageLogs = await this.purge(
      'ai_token_usage_logs',
      this.aiTokenUsageLogRepo,
      'createdAt',
      this.config.get<number>('LOG_RETENTION_AI_USAGE_DAYS', 365),
    );

    summary.aiPiiRedactionLogs = await this.purge(
      'ai_pii_redaction_logs',
      this.aiPiiRedactionLogRepo,
      'createdAt',
      this.config.get<number>('LOG_RETENTION_PII_DAYS', 180),
    );

    summary.staleNotificationLogs = await this.purge(
      'stale_notification_logs',
      this.staleNotificationLogRepo,
      'notifiedAt',
      this.config.get<number>('LOG_RETENTION_STALE_DAYS', 60),
    );

    summary.readNotifications = await this.purgeReadNotifications(
      this.config.get<number>('LOG_RETENTION_READ_NOTIFICATION_DAYS', 90),
    );

    this.logger.log(`[LogRetention] concluído ${JSON.stringify(summary)}`);
  }

  private async purgeReadNotifications(days: number): Promise<number> {
    const cutoff = this.cutoffFor(days);
    if (!cutoff) return 0;
    try {
      const affected =
        await this.notificationRepository.deleteReadOlderThan(cutoff);
      if (affected > 0) {
        this.logger.log(
          `[LogRetention] notifications (lidas): removidas ${affected} linhas (cutoff=${cutoff.toISOString()})`,
        );
      }
      return affected;
    } catch (err: unknown) {
      this.logger.warn(
        `[LogRetention] falha ao limpar notifications lidas: ${errorMessage(err)}`,
      );
      return 0;
    }
  }

  private cutoffFor(days: number): Date | null {
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.now() - Number(days) * MS_PER_DAY);
  }

  private async purge<T extends object>(
    label: string,
    repo: Repository<T>,
    timestampColumn: string,
    days: number,
  ): Promise<number> {
    const cutoff = this.cutoffFor(days);
    if (!cutoff) return 0;

    try {
      const result = await repo.delete({
        [timestampColumn]: LessThan(cutoff),
      } as any);
      const affected = result.affected ?? 0;
      if (affected > 0) {
        this.logger.log(
          `[LogRetention] ${label}: removidas ${affected} linhas (cutoff=${cutoff.toISOString()})`,
        );
      }
      return affected;
    } catch (err: unknown) {
      this.logger.warn(
        `[LogRetention] falha ao limpar ${label}: ${errorMessage(err)}`,
      );
      return 0;
    }
  }
}
