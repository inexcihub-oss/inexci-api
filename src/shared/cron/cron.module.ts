import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronService } from './cron.service';
import { MailModule } from '../mail/mail.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { StaleNotificationLog } from 'src/database/entities/stale-notification-log.entity';
import { StaleNotificationLogRepository } from 'src/database/repositories/stale-notification-log.repository';
import { User } from 'src/database/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StaleNotificationLog, User]),
    MailModule,
    WhatsappModule,
    NotificationsModule,
  ],
  providers: [
    CronService,
    StaleNotificationService,
    StaleNotificationLogRepository,
  ],
  exports: [CronService, StaleNotificationService],
})
export class CronModule {}
