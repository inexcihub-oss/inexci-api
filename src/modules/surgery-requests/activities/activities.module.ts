import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestActivityMention } from 'src/database/entities/surgery-request-activity-mention.entity';
import { Notification } from 'src/database/entities/notification.entity';
import { UserNotificationSettings } from 'src/database/entities/user-notification-settings.entity';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { User } from 'src/database/entities/user.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { MailModule } from 'src/shared/mail/mail.module';
import { ActivityMentionsService } from './mentions/activity-mentions.service';
import {
  MENTION_EMAILS_QUEUE,
  MentionEmailsJobsService,
} from './mentions/mention-emails-jobs.service';
import { MentionEmailsProcessor } from './mentions/mention-emails.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SurgeryRequestActivity,
      SurgeryRequestActivityMention,
      SurgeryRequest,
      User,
      Notification,
      UserNotificationSettings,
    ]),
    BullModule.registerQueue({ name: MENTION_EMAILS_QUEUE }),
    NotificationsModule,
    MailModule,
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    StorageService,
    SurgeryRequestActivityMentionRepository,
    NotificationRepository,
    UserNotificationSettingsRepository,
    ActivityMentionsService,
    MentionEmailsJobsService,
    MentionEmailsProcessor,
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
