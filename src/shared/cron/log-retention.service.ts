import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { AiTokenUsageLog } from 'src/database/entities/ai-token-usage-log.entity';
import { AiPiiRedactionLog } from 'src/database/entities/ai-pii-redaction-log.entity';
import { StaleNotificationLog } from 'src/database/entities/stale-notification-log.entity';

/**
 * Cron diário (04:00 America/Sao_Paulo) que aplica retenção configurável
 * para tabelas de log persistido. Mantém o banco enxuto e atende às
 * janelas LGPD declaradas na política de privacidade.
 *
 * Janelas (defaults; override via env):
 *   - notification_send_logs:   90 dias  (LOG_RETENTION_NOTIFICATION_DAYS)
 *   - ai_token_usage_logs:     365 dias  (LOG_RETENTION_AI_USAGE_DAYS)
 *   - ai_pii_redaction_logs:   180 dias  (LOG_RETENTION_PII_DAYS)
 *   - stale_notification_logs:  60 dias  (LOG_RETENTION_STALE_DAYS)
 */
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

    this.logger.log(`[LogRetention] concluído ${JSON.stringify(summary)}`);
  }

  private async purge<T extends object>(
    label: string,
    repo: Repository<T>,
    timestampColumn: string,
    days: number,
  ): Promise<number> {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(days));

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
    } catch (err: any) {
      this.logger.warn(
        `[LogRetention] falha ao limpar ${label}: ${err?.message ?? err}`,
      );
      return 0;
    }
  }
}
