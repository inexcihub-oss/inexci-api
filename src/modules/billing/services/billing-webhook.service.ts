import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { reportPlatformError } from 'src/shared/observability/platform-errors/platform-error-sink';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { PaymentGatewayEventRepository } from 'src/database/repositories/payment-gateway-event.repository';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';

import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import {
  GatewayInvoice,
  GatewaySubscription,
  NormalizedWebhookEvent,
  VerifyWebhookInput,
} from 'src/shared/payment-gateway/payment-gateway.types';

import { SubscriptionService } from './subscription.service';
import { InvoiceMirrorService } from './invoice-mirror.service';
import { DistributedLockService } from 'src/shared/locks/distributed-lock.service';

export interface ReprocessedWebhookEvent {
  id: string;
  eventId: string;
  processedAt: Date;
}

const INVOICE_EVENTS: ReadonlySet<NormalizedWebhookEvent['type']> = new Set([
  'invoice.paid',
  'invoice.failed',
  'invoice.overdue',
  'invoice.finalized',
  'invoice.voided',
]);

export const GATEWAY_EVENT_LOCK_TTL_MS = 5 * 60 * 1000;

export const EVENTO_EM_PROCESSAMENTO =
  'Este evento já está sendo processado. Aguarde e tente novamente.';

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly eventRepo: PaymentGatewayEventRepository,
    private readonly subscriptionService: SubscriptionService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly invoiceMirror: InvoiceMirrorService,
    private readonly lock: DistributedLockService,
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

    const lockKey = this.lockKeyOf(stored.id);
    let token: string | null;
    try {
      token = await this.lock.acquire(lockKey, GATEWAY_EVENT_LOCK_TTL_MS);
    } catch (err) {
      this.logger.warn(
        `Trava do webhook ${event.eventId} indisponível, processando sem ela: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.process(stored.id, event);
      return;
    }
    if (!token) throw new ConflictException(EVENTO_EM_PROCESSAMENTO);

    try {
      const fresh = await this.eventRepo.findOne({ id: stored.id });
      if (fresh?.processedAt) return;
      await this.process(stored.id, event);
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  async reprocessStored(storedId: string): Promise<ReprocessedWebhookEvent> {
    const lockKey = this.lockKeyOf(storedId);
    const token = await this.lock.acquire(lockKey, GATEWAY_EVENT_LOCK_TTL_MS);
    if (!token) throw new ConflictException(EVENTO_EM_PROCESSAMENTO);

    try {
      const stored = await this.eventRepo.findOne({ id: storedId });
      if (!stored) throw new NotFoundException('Evento não encontrado.');
      if (stored.processedAt) {
        throw new ConflictException('Este evento já foi processado.');
      }
      const event = this.gateway.parseWebhookEvent(stored.payload);
      if (event.type === 'unknown') {
        throw new ConflictException(
          'O conteúdo gravado deste evento não é reconhecido.',
        );
      }
      const processedAt = await this.process(stored.id, event);
      return { id: stored.id, eventId: event.eventId, processedAt };
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  private lockKeyOf(storedId: string): string {
    return `gateway-event:${storedId}`;
  }

  private async process(
    storedId: string,
    event: NormalizedWebhookEvent,
  ): Promise<Date> {
    try {
      await this.dispatch(event);
      if (INVOICE_EVENTS.has(event.type)) {
        await this.mirrorInvoice(event);
      }
      const processedAt = new Date();
      await this.eventRepo.update(storedId, {
        processedAt,
        error: null,
      });
      return processedAt;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falha ao processar webhook ${event.eventId}: ${message}`,
      );
      await this.eventRepo.update(storedId, {
        error: message.slice(0, 1000),
      });
      void this.reportFailure(event, err);
      throw err;
    }
  }

  private async reportFailure(
    event: NormalizedWebhookEvent,
    error: unknown,
  ): Promise<void> {
    let ownerId: string | null = null;
    try {
      const { subscriptionId, customerId } = event.refs ?? {};
      const local =
        (subscriptionId
          ? await this.subscriptionRepo.findByGatewaySubscriptionId(
              subscriptionId,
            )
          : null) ??
        (customerId
          ? await this.subscriptionRepo.findByGatewayCustomerId(customerId)
          : null);
      ownerId = local?.ownerId ?? null;
    } catch {}
    reportPlatformError({
      source: 'stripe_webhook',
      route: event.type,
      error,
      ownerId,
    });
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

  private async mirrorInvoice(event: NormalizedWebhookEvent): Promise<void> {
    let invoice: GatewayInvoice | null = event.invoice ?? null;
    const invoiceId = event.refs?.invoiceId ?? invoice?.id;
    if (invoiceId) {
      try {
        invoice = (await this.gateway.getInvoice(invoiceId)) ?? invoice;
      } catch (err) {
        this.logger.warn(
          `[invoice-mirror] releitura da fatura ${invoiceId} falhou, usando o evento ${event.eventId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (!invoice) return;
    try {
      await this.invoiceMirror.upsertFromGateway(invoice);
    } catch (err) {
      this.logger.error(
        `[invoice-mirror] falha ao espelhar fatura ${invoice.id} (evento ${event.eventId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

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
    if (local.status === SubscriptionStatus.INTERNAL) {
      this.logger.warn(
        `checkout.completed ignorado: subscription=${local.id} tem acesso interno (gateway ${subscriptionId})`,
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
    await this.subscriptionService.syncFromGatewaySubscription(
      await this.withLiveDiscount(gatewaySub),
    );
  }

  private async withLiveDiscount(
    gatewaySub: GatewaySubscription,
  ): Promise<GatewaySubscription> {
    if (gatewaySub.discount !== undefined) return gatewaySub;
    try {
      const expanded = await this.gateway.getSubscriptionWithDiscount(
        gatewaySub.id,
      );
      if (!expanded || expanded.discount === undefined) return gatewaySub;
      return { ...gatewaySub, discount: expanded.discount };
    } catch (err) {
      this.logger.warn(
        `[webhook] desconto de ${gatewaySub.id} indisponível, mantendo o gravado: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return gatewaySub;
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
