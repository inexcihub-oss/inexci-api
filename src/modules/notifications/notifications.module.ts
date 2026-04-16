import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { Notification } from 'src/database/entities/notification.entity';
import { UserNotificationSettings } from 'src/database/entities/user-notification-settings.entity';
import { User } from 'src/database/entities/user.entity';
import { EmailModule } from 'src/shared/email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, UserNotificationSettings, User]),
    EmailModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
