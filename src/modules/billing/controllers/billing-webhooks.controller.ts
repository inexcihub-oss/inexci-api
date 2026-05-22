import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from 'src/shared/decorator/is-public.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';
import { BillingWebhookService } from '../services/billing-webhook.service';

@ApiExcludeController()
@Controller('billing/webhooks')
export class BillingWebhooksController {
  private readonly logger = new Logger(BillingWebhooksController.name);

  constructor(private readonly webhookService: BillingWebhookService) {}

  @Public()
  @SkipConsentCheck()
  @Post('stripe')
  @HttpCode(200)
  async stripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const rawBody = req.rawBody;
    try {
      await this.webhookService.handle({ payload: rawBody, headers });
    } catch (err) {
      const status = (err as { httpStatus?: number })?.httpStatus;
      if (status === 401 || status === 503) {
        throw err;
      }
      this.logger.warn(
        `Erro processando webhook Stripe (resposta 200 mantida): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { ok: true };
  }
}
