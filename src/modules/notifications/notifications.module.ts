import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PatientNotificationService } from './patient-notification.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { WeeklySummaryService } from './weekly-summary.service';
import { Notification } from 'src/database/entities/notification.entity';
import { UserNotificationSettings } from 'src/database/entities/user-notification-settings.entity';
import { User } from 'src/database/entities/user.entity';
import { MailModule } from 'src/shared/mail/mail.module';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';
import { PendenciesModule } from 'src/modules/surgery-requests/pendencies/pendencies.module';

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
    forwardRef(() => PendenciesModule),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsGateway,
    NotificationsService,
    PatientNotificationService,
    NotificationDispatcherService,
    WeeklySummaryService,
  ],
  exports: [
    NotificationsGateway,
    NotificationsService,
    PatientNotificationService,
    NotificationDispatcherService,
    WeeklySummaryService,
  ],
})
export class NotificationsModule {}
