import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestActivityMention } from 'src/database/entities/surgery-request-activity-mention.entity';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { User } from 'src/database/entities/user.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { MailModule } from 'src/shared/mail/mail.module';
import { ActivityMentionsService } from './mentions/activity-mentions.service';
import { MentionEmailsJobsService } from './mentions/mention-emails-jobs.service';
import { QueuesModule } from 'src/shared/queues/queues.module';
import { MentionEmailsProcessor } from './mentions/mention-emails.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SurgeryRequestActivity,
      SurgeryRequestActivityMention,
      SurgeryRequest,
      User,
    ]),
    // A fila vem configurada (retry, backoff, métricas) de QueuesModule —
    // registrá-la aqui de novo criaria outra instância, sem essas opções.
    QueuesModule,
    NotificationsModule,
    MailModule,
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    StorageService,
    SurgeryRequestActivityMentionRepository,
    ActivityMentionsService,
    MentionEmailsJobsService,
    MentionEmailsProcessor,
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
