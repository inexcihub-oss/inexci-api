import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../shared/decorator/is-public.decorator';
import { WebhookService } from './webhook.service';
import { AiOrchestratorService } from '../../shared/ai/services/ai-orchestrator.service';
import { maskPhone } from '../../shared/utils';

@ApiExcludeController()
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly aiOrchestrator: AiOrchestratorService,
  ) {}

  private mapInteractiveButtonPayloadToBody(
    payload: string,
    buttonText: string,
    fallbackBody: string,
  ): string {
    const normalizedPayload = (payload || '').trim().toLowerCase();
    const normalizedButtonText = (buttonText || '').trim().toLowerCase();

    const confirmTokens = new Set([
      'sim',
      'confirmar',
      'confirm',
      'yes',
      'ai_confirm_yes',
      'confirm_yes',
    ]);

    const cancelTokens = new Set([
      'nao',
      'não',
      'cancelar',
      'cancel',
      'no',
      'ai_confirm_no',
      'confirm_no',
      'ai_cancel',
    ]);

    if (
      confirmTokens.has(normalizedPayload) ||
      confirmTokens.has(normalizedButtonText)
    ) {
      return 'sim';
    }

    if (
      cancelTokens.has(normalizedPayload) ||
      cancelTokens.has(normalizedButtonText)
    ) {
      return 'não';
    }

    if (buttonText?.trim()) {
      return buttonText;
    }

    return fallbackBody;
  }

  @Post('twilio')
  @Public()
  @HttpCode(200)
  async handleTwilioWebhook(
    @Body() body: Record<string, any>,
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ): Promise<string> {
    const host = req.get('host') || '';
    const originalUrl = req.originalUrl || '/webhooks/twilio';
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocolCandidates = [forwardedProto, req.protocol, 'https', 'http']
      .filter((p): p is string => Boolean(p))
      .filter((value, index, arr) => arr.indexOf(value) === index);

    const urlCandidates = protocolCandidates.map(
      (protocol) => `${protocol}://${host}${originalUrl}`,
    );

    this.webhookService.validateTwilioSignature(
      signature || '',
      urlCandidates,
      req.body,
    );

    const from = typeof body?.From === 'string' ? body.From : '';
    const fallbackBody = typeof body?.Body === 'string' ? body.Body : '';
    const buttonPayload =
      typeof body?.ButtonPayload === 'string' ? body.ButtonPayload : '';
    const buttonText =
      typeof body?.ButtonText === 'string' ? body.ButtonText : '';
    const messageBody = this.mapInteractiveButtonPayloadToBody(
      buttonPayload,
      buttonText,
      fallbackBody,
    );
    const messageSid =
      typeof body?.MessageSid === 'string'
        ? body.MessageSid
        : typeof body?.SmsMessageSid === 'string'
          ? body.SmsMessageSid
          : typeof body?.SmsSid === 'string'
            ? body.SmsSid
            : '';
    const mediaUrl =
      typeof body?.MediaUrl0 === 'string' ? body.MediaUrl0 : null;
    const numMediaRaw = Number(body?.NumMedia ?? 0);
    const mediaCount = Number.isFinite(numMediaRaw)
      ? Math.max(0, Math.min(10, numMediaRaw))
      : 0;
    const media = Array.from({ length: mediaCount })
      .map((_, index) => {
        const url = body?.[`MediaUrl${index}`];
        const contentType = body?.[`MediaContentType${index}`];
        const durationRaw = body?.[`MediaDuration${index}`];
        const durationCandidate = Number(durationRaw);
        const durationSeconds = Number.isFinite(durationCandidate)
          ? durationCandidate
          : null;
        if (typeof url !== 'string' || !url.trim()) return null;
        const normalizedContentType =
          typeof contentType === 'string' && contentType.trim().length
            ? contentType
            : null;
        const lowerMime = normalizedContentType?.toLowerCase() ?? '';
        let category: 'audio' | 'image' | 'pdf' | 'other' = 'other';
        if (lowerMime.startsWith('audio/')) {
          category = 'audio';
        } else if (lowerMime.startsWith('image/')) {
          category = 'image';
        } else if (lowerMime === 'application/pdf') {
          category = 'pdf';
        }
        return {
          url,
          contentType: normalizedContentType,
          category,
          durationSeconds,
        };
      })
      .filter(
        (
          item,
        ): item is {
          url: string;
          contentType: string | null;
          category: 'audio' | 'image' | 'pdf' | 'other';
          durationSeconds: number | null;
        } => item !== null,
      );

    if (!from || !messageSid) {
      this.logger.warn(
        `Webhook Twilio ignorado por payload incompleto. From: ${from ? maskPhone(from) : 'N/A'}, MessageSid: ${messageSid || 'N/A'}`,
      );
      return '<Response></Response>';
    }

    try {
      await this.aiOrchestrator.enqueueInboundMessage({
        from,
        body: messageBody,
        messageSid,
        mediaUrl,
        media,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao enfileirar mensagem inbound (${messageSid})`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return '<Response></Response>';
  }
}
