import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { AiModule } from '../../shared/ai/ai.module';
import { WhatsappModule } from '../../shared/whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SurgeryRequestsModule } from '../surgery-requests/surgery-requests.module';
import { PhoneNormalizerService } from '../../shared/ai/services/orchestrator/phone-normalizer.service';

@Module({
  imports: [
    AiModule,
    WhatsappModule,
    NotificationsModule,
    SurgeryRequestsModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService, PhoneNormalizerService],
})
export class WebhookModule {}
