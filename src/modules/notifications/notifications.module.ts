import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PatientNotificationService } from './patient-notification.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { Notification } from 'src/database/entities/notification.entity';
import { UserNotificationSettings } from 'src/database/entities/user-notification-settings.entity';
import { User } from 'src/database/entities/user.entity';
import { MailModule } from 'src/shared/mail/mail.module';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, UserNotificationSettings, User]),
    MailModule,
    WhatsappModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PatientNotificationService,
    NotificationDispatcherService,
  ],
  exports: [
    NotificationsService,
    PatientNotificationService,
    NotificationDispatcherService,
  ],
})
export class NotificationsModule {}
