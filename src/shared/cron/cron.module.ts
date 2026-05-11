import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronService } from './cron.service';
import { CronController } from './cron.controller';
import { LogRetentionService } from './log-retention.service';
import { MailModule } from '../mail/mail.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { StaleNotificationLog } from 'src/database/entities/stale-notification-log.entity';
import { StaleNotificationLogRepository } from 'src/database/repositories/stale-notification-log.repository';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { AiTokenUsageLog } from 'src/database/entities/ai-token-usage-log.entity';
import { AiPiiRedactionLog } from 'src/database/entities/ai-pii-redaction-log.entity';
import { User } from 'src/database/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StaleNotificationLog,
      NotificationSendLog,
      AiTokenUsageLog,
      AiPiiRedactionLog,
      User,
    ]),
    MailModule,
    WhatsappModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [CronController],
  providers: [
    CronService,
    LogRetentionService,
    StaleNotificationService,
    StaleNotificationLogRepository,
  ],
  exports: [CronService, LogRetentionService, StaleNotificationService],
})
export class CronModule {}
