import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThan, Repository } from 'typeorm';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { AiTokenUsageLog } from 'src/database/entities/ai-token-usage-log.entity';
import { AiPiiRedactionLog } from 'src/database/entities/ai-pii-redaction-log.entity';
import { StaleNotificationLog } from 'src/database/entities/stale-notification-log.entity';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { ClinicalAccessAuditRepository } from 'src/database/repositories/clinical-access-audit.repository';
import { PlatformErrorDailyRepository } from 'src/database/repositories/platform-error-daily.repository';
import { PlatformSecurityDailyRepository } from 'src/database/repositories/platform-security-daily.repository';
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
    private readonly clinicalAccessAuditRepository: ClinicalAccessAuditRepository,
    private readonly platformErrorDailyRepository: PlatformErrorDailyRepository,
    private readonly platformSecurityDailyRepository: PlatformSecurityDailyRepository,
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
      clinicalAccessAudit: 0,
      platformErrorDaily: 0,
      platformSecurityDaily: 0,
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

    summary.clinicalAccessAudit = await this.purgeClinicalAccessAudit(
      this.config.get<number>('LOG_RETENTION_CLINICAL_AUDIT_DAYS', 1825),
    );

    summary.platformErrorDaily = await this.purgePlatformErrorDaily(
      this.config.get<number>('LOG_RETENTION_PLATFORM_ERROR_DAYS', 90),
    );

    summary.platformSecurityDaily = await this.purgePlatformSecurityDaily(
      this.config.get<number>('LOG_RETENTION_PLATFORM_SECURITY_DAYS', 90),
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

  private async purgeClinicalAccessAudit(days: number): Promise<number> {
    const cutoff = this.cutoffFor(days);
    if (!cutoff) return 0;
    try {
      const affected =
        await this.clinicalAccessAuditRepository.deleteOlderThan(cutoff);
      if (affected > 0) {
        this.logger.log(
          `[LogRetention] clinical_access_audit: removidas ${affected} linhas (cutoff=${cutoff.toISOString()})`,
        );
      }
      return affected;
    } catch (err: unknown) {
      this.logger.warn(
        `[LogRetention] falha ao limpar clinical_access_audit: ${errorMessage(err)}`,
      );
      return 0;
    }
  }

  private async purgePlatformSecurityDaily(days: number): Promise<number> {
    const cutoff = this.cutoffFor(days);
    if (!cutoff) return 0;
    const day = cutoff.toISOString().slice(0, 10);
    try {
      const affected =
        await this.platformSecurityDailyRepository.purgeBefore(day);
      if (affected > 0) {
        this.logger.log(
          `[LogRetention] platform_security_daily: removidas ${affected} linhas (antes de ${day})`,
        );
      }
      return affected;
    } catch (err: unknown) {
      this.logger.warn(
        `[LogRetention] falha ao limpar platform_security_daily: ${errorMessage(err)}`,
      );
      return 0;
    }
  }

  private async purgePlatformErrorDaily(days: number): Promise<number> {
    const cutoff = this.cutoffFor(days);
    if (!cutoff) return 0;
    const day = cutoff.toISOString().slice(0, 10);
    try {
      const affected = await this.platformErrorDailyRepository.purgeBefore(day);
      if (affected > 0) {
        this.logger.log(
          `[LogRetention] platform_error_daily: removidas ${affected} linhas (antes de ${day})`,
        );
      }
      return affected;
    } catch (err: unknown) {
      this.logger.warn(
        `[LogRetention] falha ao limpar platform_error_daily: ${errorMessage(err)}`,
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
      } as FindOptionsWhere<T>);
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
