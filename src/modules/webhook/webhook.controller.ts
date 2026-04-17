import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../shared/decorator/is-public.decorator';
import { WebhookService } from './webhook.service';
import { TwilioWebhookDto } from './dto/twilio-webhook.dto';
import { AiOrchestratorService } from '../../shared/ai/services/ai-orchestrator.service';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly aiOrchestrator: AiOrchestratorService,
  ) {}

  @Post('twilio')
  @Public()
  @HttpCode(200)
  async handleTwilioWebhook(
    @Body() body: TwilioWebhookDto,
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ): Promise<string> {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    this.webhookService.validateTwilioSignature(signature || '', url, req.body);

    await this.aiOrchestrator.enqueueInboundMessage({
      from: body.From,
      body: body.Body,
      messageSid: body.MessageSid,
      mediaUrl: body.MediaUrl0 || null,
    });

    return '<Response></Response>';
  }
}
