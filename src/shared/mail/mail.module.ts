import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountStatusModule } from 'src/shared/account-status/account-status.module';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'mail',
    }),
    TypeOrmModule.forFeature([NotificationSendLog]),
    AccountStatusModule,
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
