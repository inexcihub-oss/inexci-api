import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { AiModule } from '../../shared/ai/ai.module';
import { WhatsappModule } from '../../shared/whatsapp/whatsapp.module';

@Module({
  imports: [AiModule, WhatsappModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
