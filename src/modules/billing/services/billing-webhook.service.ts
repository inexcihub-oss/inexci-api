import { Inject, Injectable, Logger } from '@nestjs/common';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { PaymentGatewayEventRepository } from 'src/database/repositories/payment-gateway-event.repository';

import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import {
  NormalizedWebhookEvent,
  VerifyWebhookInput,
} from 'src/shared/payment-gateway/payment-gateway.types';

import { SubscriptionService } from './subscription.service';

/**
 * Recebe e processa webhooks do gateway de pagamento.
 *
 * Garantias:
 * - Idempotência: cada `(provider, eventId)` é processado uma única vez.
 * - Resiliência: erros de processamento são gravados em
 *   `payment_gateway_events.error` para investigação.
 *
 * Eventos cobertos:
 * - `checkout.completed`          → vincula customer+subscription; chama sync.
 * - `subscription.created/updated` → sincroniza espelho local (status, plano, cota).
 * - `subscription.canceled`       → cancela localmente.
 * - `invoice.paid`                → marca ACTIVE.
 * - `invoice.failed/overdue`      → marca PAST_DUE.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly eventRepo: PaymentGatewayEventRepository,
    private readonly subscriptionService: SubscriptionService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async handle(input: VerifyWebhookInput): Promise<void> {
    this.gateway.verifyWebhook(input);

    const event = this.gateway.parseWebhookEvent(input.payload);
    if (event.type === 'unknown') {
      this.logger.debug(
        `Webhook ignorado (tipo não reconhecido): eventId=${event.eventId}`,
      );
      return;
    }

    const existing = await this.eventRepo.findByProviderEvent(
      this.gateway.providerId,
      event.eventId,
    );
    if (existing?.processedAt) {
      this.logger.debug(
        `Webhook ${event.eventId} já processado em ${existing.processedAt.toISOString()}`,
      );
      return;
    }

    const stored =
      existing ??
      (await this.eventRepo.create({
        gatewayProvider: this.gateway.providerId,
        eventId: event.eventId,
        eventType: event.type,
        payload: event.raw,
      }));

    try {
      await this.dispatch(event);
      await this.eventRepo.update(stored.id, {
        processedAt: new Date(),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falha ao processar webhook ${event.eventId}: ${message}`,
      );
      await this.eventRepo.update(stored.id, {
        error: message.slice(0, 1000),
      });
      throw err;
    }
  }

  private async dispatch(event: NormalizedWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'checkout.completed':
        return this.handleCheckoutCompleted(event);
      case 'subscription.created':
      case 'subscription.updated':
        return this.handleSubscriptionSync(event);
      case 'subscription.canceled':
        return this.handleSubscriptionCanceled(event);
      case 'invoice.paid':
        return this.handleInvoicePaid(event);
      case 'invoice.failed':
      case 'invoice.overdue':
        return this.handleInvoiceFailed(event);
      default:
        return;
    }
  }

  // ───── Handlers ─────

  private async handleCheckoutCompleted(event: NormalizedWebhookEvent) {
    const { customerId, subscriptionId } = event.refs ?? {};
    if (!customerId || !subscriptionId) return;

    const local =
      await this.subscriptionRepo.findByGatewayCustomerId(customerId);
    if (!local) {
      this.logger.warn(
        `checkout.completed sem subscription local para customer=${customerId}`,
      );
      return;
    }

    if (local.gatewaySubscriptionId !== subscriptionId) {
      await this.subscriptionRepo.update(local.id, {
        gatewaySubscriptionId: subscriptionId,
      });
    }

    const gatewaySub = await this.gateway.getSubscription(subscriptionId);
    if (!gatewaySub) {
      this.logger.warn(
        `checkout.completed: subscription ${subscriptionId} não encontrada no gateway`,
      );
      return;
    }
    await this.subscriptionService.syncFromGatewaySubscription(gatewaySub);
  }

  private async handleSubscriptionSync(event: NormalizedWebhookEvent) {
    const subscriptionId = event.refs?.subscriptionId;
    if (!subscriptionId) return;

    const gatewaySub = await this.gateway.getSubscription(subscriptionId);
    if (!gatewaySub) return;
    await this.subscriptionService.syncFromGatewaySubscription(gatewaySub);
  }

  private async handleSubscriptionCanceled(event: NormalizedWebhookEvent) {
    const subscriptionId = event.refs?.subscriptionId;
    if (!subscriptionId) return;
    const local =
      await this.subscriptionRepo.findByGatewaySubscriptionId(subscriptionId);
    if (local) {
      await this.subscriptionService.cancelImmediately(local.id);
    }
  }

  private async handleInvoicePaid(event: NormalizedWebhookEvent) {
    const subscriptionId = event.refs?.subscriptionId;
    if (!subscriptionId) return;
    const local =
      await this.subscriptionRepo.findByGatewaySubscriptionId(subscriptionId);
    if (local) {
      await this.subscriptionService.markActive(local.id);
    }
  }

  private async handleInvoiceFailed(event: NormalizedWebhookEvent) {
    const subscriptionId = event.refs?.subscriptionId;
    if (!subscriptionId) return;
    const local =
      await this.subscriptionRepo.findByGatewaySubscriptionId(subscriptionId);
    if (local) {
      await this.subscriptionService.markPastDue(local.id, event.occurredAt);
    }
  }
}
