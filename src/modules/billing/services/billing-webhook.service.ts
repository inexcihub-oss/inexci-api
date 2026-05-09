import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { InvoiceRepository } from 'src/database/repositories/invoice.repository';
import { PaymentGatewayEventRepository } from 'src/database/repositories/payment-gateway-event.repository';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import { InvoiceStatus } from 'src/database/entities/invoice.entity';

import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import {
  GatewayInvoice,
  NormalizedWebhookEvent,
  VerifyWebhookInput,
} from 'src/shared/payment-gateway/payment-gateway.types';

import { SubscriptionService } from './subscription.service';

/**
 * Recebe e processa webhooks do gateway de pagamento.
 *
 * Garantias:
 * - Idempot\u00eancia: cada `(provider, eventId)` \u00e9 processado uma \u00fanica vez.
 *   Reentregas s\u00e3o silenciosamente ignoradas (status 200 mesmo assim).
 * - Resili\u00eancia: erros de processamento s\u00e3o gravados em
 *   `payment_gateway_events.error` para investiga\u00e7\u00e3o.
 *
 * Eventos cobertos (vide `NormalizedWebhookEventType`):
 * - `invoice.paid`     \u2192 atualiza fatura, marca subscription ACTIVE,
 *                        avan\u00e7a per\u00edodo e renova quota.
 * - `invoice.failed`   \u2192 atualiza fatura, marca subscription PAST_DUE.
 * - `invoice.overdue`  \u2192 idem.
 * - `invoice.created`  \u2192 cria fatura local com status PENDING.
 * - `invoice.refunded` \u2192 marca fatura como REFUNDED.
 * - `subscription.canceled` \u2192 cancela subscription local imediatamente.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly invoiceRepo: InvoiceRepository,
    private readonly eventRepo: PaymentGatewayEventRepository,
    private readonly planRepo: SubscriptionPlanRepository,
    private readonly subscriptionService: SubscriptionService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly _config: ConfigService,
  ) {}

  /**
   * Verifica assinatura e processa o evento.
   * Lan\u00e7a em caso de assinatura inv\u00e1lida; respostas n\u00e3o-200 fazem o
   * gateway reentregar.
   */
  async handle(input: VerifyWebhookInput): Promise<void> {
    this.gateway.verifyWebhook(input);

    const event = this.gateway.parseWebhookEvent(input.payload);
    if (event.type === 'unknown') {
      this.logger.debug(
        `Webhook ignorado (tipo n\u00e3o reconhecido): eventId=${event.eventId}`,
      );
      return;
    }

    // Idempot\u00eancia
    const existing = await this.eventRepo.findByProviderEvent(
      this.gateway.providerId,
      event.eventId,
    );
    if (existing?.processedAt) {
      this.logger.debug(
        `Webhook ${event.eventId} j\u00e1 processado em ${existing.processedAt.toISOString()}`,
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
      case 'invoice.created':
        await this.handleInvoiceCreated(event);
        return;
      case 'invoice.paid':
        await this.handleInvoicePaid(event);
        return;
      case 'invoice.failed':
      case 'invoice.overdue':
        await this.handleInvoiceFailed(event);
        return;
      case 'invoice.refunded':
        await this.handleInvoiceRefunded(event);
        return;
      case 'subscription.canceled':
        await this.handleSubscriptionCanceled(event);
        return;
      default:
        return;
    }
  }

  // ───── Handlers de evento ─────

  private async handleInvoiceCreated(event: NormalizedWebhookEvent) {
    const invoiceId = event.refs?.invoiceId;
    const subscriptionId = event.refs?.subscriptionId;
    if (!invoiceId || !subscriptionId) return;

    const existing = await this.invoiceRepo.findByGatewayInvoiceId(invoiceId);
    if (existing) return;

    const localSub =
      await this.subscriptionRepo.findByGatewaySubscriptionId(subscriptionId);
    if (!localSub) {
      this.logger.warn(
        `invoice.created sem subscription local: ${subscriptionId}`,
      );
      return;
    }

    const gatewayInvoice = await this.gateway.getInvoice(invoiceId);
    if (!gatewayInvoice) return;

    const plan = await this.planRepo.findOne({ id: localSub.planId });
    await this.invoiceRepo.create({
      subscriptionId: localSub.id,
      ownerId: localSub.ownerId,
      amountCents: gatewayInvoice.amountCents,
      currency: 'BRL',
      status: InvoiceStatus.PENDING,
      gatewayProvider: this.gateway.providerId,
      gatewayInvoiceId: invoiceId,
      invoiceUrl: gatewayInvoice.invoiceUrl,
      dueDate: gatewayInvoice.dueDate,
      periodStart: localSub.currentPeriodStart,
      periodEnd: localSub.currentPeriodEnd,
      planSnapshot: plan
        ? {
            slug: plan.slug,
            name: plan.name,
            priceCents: plan.priceCents,
            surgeryRequestQuota: plan.surgeryRequestQuota,
          }
        : null,
    });
  }

  private async handleInvoicePaid(event: NormalizedWebhookEvent) {
    const invoiceId = event.refs?.invoiceId;
    const subscriptionId = event.refs?.subscriptionId;
    if (!invoiceId) return;

    const local = await this.invoiceRepo.findByGatewayInvoiceId(invoiceId);
    if (local) {
      await this.invoiceRepo.update(local.id, {
        status: InvoiceStatus.PAID,
        paidAt: event.occurredAt,
      });
    } else if (subscriptionId) {
      // Em alguns gateways o evento `paid` pode chegar antes do `created`;
      // popula sob demanda.
      await this.handleInvoiceCreated(event);
      const created = await this.invoiceRepo.findByGatewayInvoiceId(invoiceId);
      if (created) {
        await this.invoiceRepo.update(created.id, {
          status: InvoiceStatus.PAID,
          paidAt: event.occurredAt,
        });
      }
    }

    if (subscriptionId) {
      const localSub =
        await this.subscriptionRepo.findByGatewaySubscriptionId(subscriptionId);
      if (localSub) {
        await this.subscriptionService.advanceBillingPeriod(localSub.id);
      }
    }
  }

  private async handleInvoiceFailed(event: NormalizedWebhookEvent) {
    const invoiceId = event.refs?.invoiceId;
    const subscriptionId = event.refs?.subscriptionId;
    if (!invoiceId) return;

    const local = await this.invoiceRepo.findByGatewayInvoiceId(invoiceId);
    if (local) {
      await this.invoiceRepo.update(local.id, {
        status:
          event.type === 'invoice.overdue'
            ? InvoiceStatus.OVERDUE
            : InvoiceStatus.FAILED,
        failedAt: event.occurredAt,
        attemptCount: local.attemptCount + 1,
      });
    }

    if (subscriptionId) {
      const localSub =
        await this.subscriptionRepo.findByGatewaySubscriptionId(subscriptionId);
      if (localSub) {
        await this.subscriptionService.markPastDue(
          localSub.id,
          event.occurredAt,
        );
      }
    }
  }

  private async handleInvoiceRefunded(event: NormalizedWebhookEvent) {
    const invoiceId = event.refs?.invoiceId;
    if (!invoiceId) return;
    const local = await this.invoiceRepo.findByGatewayInvoiceId(invoiceId);
    if (local) {
      await this.invoiceRepo.update(local.id, {
        status: InvoiceStatus.REFUNDED,
      });
    }
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

  // Helper p/ testes futuros
  async _fetchGatewayInvoice(
    invoiceId: string,
  ): Promise<GatewayInvoice | null> {
    return this.gateway.getInvoice(invoiceId);
  }
}
