import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { WhatsappProcessor } from './whatsapp.processor';
import { WhatsappMessageLog } from 'src/database/entities/whatsapp-message-log.entity';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'whatsapp-messages',
    }),
    TypeOrmModule.forFeature([WhatsappMessageLog]),
  ],
  providers: [WhatsappService, WhatsappProcessor],
  exports: [WhatsappService],
})
export class WhatsappModule {}
