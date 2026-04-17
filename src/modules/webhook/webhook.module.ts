import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { AiModule } from '../../shared/ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
