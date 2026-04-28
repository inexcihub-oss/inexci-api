import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PatientNotificationService } from './patient-notification.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { Notification } from 'src/database/entities/notification.entity';
import { UserNotificationSettings } from 'src/database/entities/user-notification-settings.entity';
import { User } from 'src/database/entities/user.entity';
import { MailModule } from 'src/shared/mail/mail.module';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Notification, UserNotificationSettings, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    MailModule,
    WhatsappModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsGateway,
    NotificationsService,
    PatientNotificationService,
    NotificationDispatcherService,
  ],
  exports: [
    NotificationsGateway,
    NotificationsService,
    PatientNotificationService,
    NotificationDispatcherService,
  ],
})
export class NotificationsModule {}
