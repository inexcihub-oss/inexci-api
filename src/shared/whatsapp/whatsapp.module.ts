import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { WhatsappProcessor } from './whatsapp.processor';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { WhatsappMediaService } from './whatsapp-media.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'whatsapp-messages',
      limiter: {
        max: 1,
        duration: 1000,
      },
    }),
    TypeOrmModule.forFeature([NotificationSendLog]),
  ],
  providers: [WhatsappService, WhatsappProcessor, WhatsappMediaService],
  exports: [WhatsappService, WhatsappMediaService],
})
export class WhatsappModule {}
