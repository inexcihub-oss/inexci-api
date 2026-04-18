import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'mail',
    }),
    TypeOrmModule.forFeature([NotificationSendLog]),
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
