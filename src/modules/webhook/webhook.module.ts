import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { AiModule } from '../../shared/ai/ai.module';
import { WhatsappModule } from '../../shared/whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AiModule, WhatsappModule, NotificationsModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
