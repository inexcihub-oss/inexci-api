import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

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
  @Post('asaas')
  @HttpCode(200)
  async asaas(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    try {
      await this.webhookService.handle({ payload: body, headers });
    } catch (err) {
      // Logar o erro real, mas devolver 200 quando o erro for de processamento
      // (j\u00e1 gravado em payment_gateway_events.error). Apenas erros de
      // assinatura inv\u00e1lida devem propagar como 401.
      const status = (err as { httpStatus?: number; status?: number })
        ?.httpStatus;
      if (status === 401 || status === 503) {
        throw err;
      }
      this.logger.warn(
        `Erro processando webhook Asaas (resposta 200 mantida): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { ok: true };
  }
}
