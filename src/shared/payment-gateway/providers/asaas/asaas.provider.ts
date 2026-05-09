import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PaymentGateway,
  PaymentGatewayError,
} from '../../payment-gateway.interface';
import {
  CancelSubscriptionInput,
  CreateCustomerInput,
  CreateSubscriptionInput,
  GatewayBillingCycle,
  GatewayCustomer,
  GatewayInvoice,
  GatewayInvoiceStatus,
  GatewayPaymentMethod,
  GatewayProviderId,
  GatewaySubscription,
  GatewaySubscriptionStatus,
  NormalizedWebhookEvent,
  NormalizedWebhookEventType,
  TokenizeCardInput,
  UpdateSubscriptionInput,
  VerifyWebhookInput,
} from '../../payment-gateway.types';
import { AsaasHttpClient } from './asaas-http.client';
import {
  AsaasCreditCardTokenizeResponse,
  AsaasCustomer,
  AsaasPayment,
  AsaasPaymentStatus,
  AsaasSubscription,
  AsaasSubscriptionCycle,
  AsaasSubscriptionStatus,
  AsaasWebhookEvent,
  AsaasWebhookEventType,
} from './asaas.types';

/**
 * Implementa\u00e7\u00e3o concreta de `PaymentGateway` para a Asaas (v3).
 *
 * Recursos cobertos:
 * - Customers
 * - Tokeniza\u00e7\u00e3o de cart\u00e3o
 * - Subscriptions (cria\u00e7\u00e3o, update, cancelamento)
 * - Listagem de payments (faturas)
 * - Verifica\u00e7\u00e3o de webhook (header `asaas-access-token`)
 * - Normaliza\u00e7\u00e3o de eventos para o vocabul\u00e1rio interno
 *
 * Fora do escopo desta implementa\u00e7\u00e3o (ainda):
 * - Boleto/PIX (decis\u00e3o de produto: cart\u00e3o apenas para a recorr\u00eancia).
 * - Reembolso autom\u00e1tico via API.
 */
@Injectable()
export class AsaasProvider implements PaymentGateway {
  readonly providerId: GatewayProviderId = 'asaas';

  private readonly logger = new Logger(AsaasProvider.name);
  private readonly webhookToken: string;

  constructor(
    private readonly http: AsaasHttpClient,
    private readonly config: ConfigService,
  ) {
    this.webhookToken = this.config.get<string>('ASAAS_WEBHOOK_TOKEN', '');
  }

  // ───── Customers ─────

  async createCustomer(input: CreateCustomerInput): Promise<GatewayCustomer> {
    const created = await this.http.request<AsaasCustomer>(
      'POST',
      '/customers',
      {
        name: input.name,
        email: input.email,
        cpfCnpj: input.cpfCnpj || undefined,
        mobilePhone: input.phone || undefined,
        externalReference: input.ownerId,
      },
    );
    return this.toGatewayCustomer(created);
  }

  async getCustomer(customerId: string): Promise<GatewayCustomer | null> {
    try {
      const customer = await this.http.request<AsaasCustomer>(
        'GET',
        `/customers/${customerId}`,
      );
      return this.toGatewayCustomer(customer);
    } catch (err) {
      if (err instanceof PaymentGatewayError && err.httpStatus === 404) {
        return null;
      }
      throw err;
    }
  }

  // ───── Cart\u00e3o (tokeniza\u00e7\u00e3o) ─────

  async tokenizeCard(input: TokenizeCardInput): Promise<GatewayPaymentMethod> {
    const tokenized = await this.http.request<AsaasCreditCardTokenizeResponse>(
      'POST',
      '/creditCard/tokenize',
      {
        customer: input.customerId,
        creditCard: {
          holderName: input.holderName,
          number: input.number,
          expiryMonth: input.expiryMonth,
          expiryYear: input.expiryYear,
          ccv: input.ccv,
        },
        creditCardHolderInfo: {
          name: input.holderInfo.name,
          email: input.holderInfo.email,
          cpfCnpj: input.holderInfo.cpfCnpj,
          postalCode: input.holderInfo.postalCode,
          addressNumber: input.holderInfo.addressNumber,
          addressComplement: input.holderInfo.addressComplement || undefined,
          phone: input.holderInfo.phone || undefined,
          mobilePhone: input.holderInfo.mobilePhone || undefined,
        },
        remoteIp: input.remoteIp,
      },
    );

    const last4 = (tokenized.creditCardNumber || '').slice(-4);
    return {
      token: tokenized.creditCardToken,
      brand: tokenized.creditCardBrand,
      last4,
      holderName: input.holderName,
      expMonth: Number(input.expiryMonth),
      expYear: Number(input.expiryYear),
      raw: tokenized,
    };
  }

  // ───── Subscriptions ─────

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<GatewaySubscription> {
    const created = await this.http.request<AsaasSubscription>(
      'POST',
      '/subscriptions',
      {
        customer: input.customerId,
        billingType: 'CREDIT_CARD',
        creditCardToken: input.paymentMethodToken,
        value: this.centsToReais(input.amountCents),
        nextDueDate: this.formatDate(input.nextDueDate),
        cycle: this.toAsaasCycle(input.cycle),
        description: input.description,
        externalReference: input.externalReference,
      },
    );
    return this.toGatewaySubscription(created);
  }

  async updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<GatewaySubscription> {
    const updated = await this.http.request<AsaasSubscription>(
      'POST',
      `/subscriptions/${subscriptionId}`,
      {
        value:
          input.amountCents != null
            ? this.centsToReais(input.amountCents)
            : undefined,
        nextDueDate: input.nextDueDate
          ? this.formatDate(input.nextDueDate)
          : undefined,
        cycle: input.cycle ? this.toAsaasCycle(input.cycle) : undefined,
        description: input.description,
      },
    );
    return this.toGatewaySubscription(updated);
  }

  async cancelSubscription(
    subscriptionId: string,
    input: CancelSubscriptionInput,
  ): Promise<void> {
    // Asaas n\u00e3o tem endpoint distinto de "atPeriodEnd"; o efeito
    // \u00e9 controlado pela aplica\u00e7\u00e3o (mant\u00e9m status ACTIVE local at\u00e9
    // fim do per\u00edodo). Quando `atPeriodEnd=true` apenas registramos a
    // inten\u00e7\u00e3o; o cancel real no gateway acontece no cron de fim de per\u00edodo.
    if (input.atPeriodEnd) {
      this.logger.log(
        `[Asaas] cancelSubscription(${subscriptionId}, atPeriodEnd=true) postergado para o cron`,
      );
      return;
    }
    await this.http.request<unknown>(
      'DELETE',
      `/subscriptions/${subscriptionId}`,
    );
  }

  async getSubscription(
    subscriptionId: string,
  ): Promise<GatewaySubscription | null> {
    try {
      const sub = await this.http.request<AsaasSubscription>(
        'GET',
        `/subscriptions/${subscriptionId}`,
      );
      return this.toGatewaySubscription(sub);
    } catch (err) {
      if (err instanceof PaymentGatewayError && err.httpStatus === 404) {
        return null;
      }
      throw err;
    }
  }

  // ───── Faturas (payments na Asaas) ─────

  async getInvoice(invoiceId: string): Promise<GatewayInvoice | null> {
    try {
      const payment = await this.http.request<AsaasPayment>(
        'GET',
        `/payments/${invoiceId}`,
      );
      return this.toGatewayInvoice(payment);
    } catch (err) {
      if (err instanceof PaymentGatewayError && err.httpStatus === 404) {
        return null;
      }
      throw err;
    }
  }

  async listInvoicesBySubscription(
    subscriptionId: string,
  ): Promise<GatewayInvoice[]> {
    const resp = await this.http.request<{ data: AsaasPayment[] }>(
      'GET',
      `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=100`,
    );
    return (resp?.data ?? []).map((p) => this.toGatewayInvoice(p));
  }

  // ───── Webhooks ─────

  verifyWebhook(input: VerifyWebhookInput): void {
    if (!this.webhookToken) {
      throw new PaymentGatewayError(
        'ASAAS_WEBHOOK_TOKEN n\u00e3o configurada \u2014 webhook rejeitado',
        'WEBHOOK_NOT_CONFIGURED',
        503,
      );
    }
    const headerToken = this.extractHeader(input.headers, 'asaas-access-token');
    if (!headerToken || headerToken !== this.webhookToken) {
      throw new PaymentGatewayError(
        'Assinatura de webhook Asaas inv\u00e1lida',
        'WEBHOOK_INVALID_SIGNATURE',
        401,
      );
    }
  }

  parseWebhookEvent(payload: unknown): NormalizedWebhookEvent {
    const evt = payload as AsaasWebhookEvent;
    if (!evt || typeof evt !== 'object' || !evt.event) {
      return {
        eventId: 'unknown',
        type: 'unknown',
        resourceId: '',
        occurredAt: new Date(),
        raw: payload,
      };
    }

    const occurredAt = evt.dateCreated ? new Date(evt.dateCreated) : new Date();

    if (evt.subscription) {
      const type = this.mapAsaasSubscriptionEvent(evt.event);
      return {
        eventId: this.makeEventId(evt.event, evt.subscription.id),
        type,
        resourceId: evt.subscription.id,
        occurredAt,
        raw: evt,
        refs: {
          subscriptionId: evt.subscription.id,
          customerId: evt.subscription.customer,
        },
      };
    }

    if (evt.payment) {
      const type = this.mapAsaasPaymentEvent(evt.event);
      return {
        eventId: this.makeEventId(evt.event, evt.payment.id),
        type,
        resourceId: evt.payment.id,
        occurredAt,
        raw: evt,
        refs: {
          invoiceId: evt.payment.id,
          subscriptionId: evt.payment.subscription || undefined,
          customerId: evt.payment.customer,
        },
      };
    }

    return {
      eventId: this.makeEventId(evt.event, evt.id || 'unknown'),
      type: 'unknown',
      resourceId: '',
      occurredAt,
      raw: evt,
    };
  }

  // ───── Helpers de normaliza\u00e7\u00e3o ─────

  private toGatewayCustomer(c: AsaasCustomer): GatewayCustomer {
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      cpfCnpj: c.cpfCnpj ?? null,
      phone: c.mobilePhone ?? c.phone ?? null,
      raw: c,
    };
  }

  private toGatewaySubscription(s: AsaasSubscription): GatewaySubscription {
    return {
      id: s.id,
      customerId: s.customer,
      status: this.mapSubStatus(s.status, s.deleted),
      cycle: this.fromAsaasCycle(s.cycle),
      amountCents: this.reaisToCents(s.value),
      nextDueDate: s.nextDueDate ? new Date(s.nextDueDate) : null,
      raw: s,
    };
  }

  private toGatewayInvoice(p: AsaasPayment): GatewayInvoice {
    return {
      id: p.id,
      subscriptionId: p.subscription || null,
      customerId: p.customer,
      amountCents: this.reaisToCents(p.value),
      status: this.mapPaymentStatus(p.status, p.deleted),
      dueDate: new Date(p.dueDate),
      paidAt: p.paymentDate ? new Date(p.paymentDate) : null,
      invoiceUrl: p.invoiceUrl || null,
      raw: p,
    };
  }

  private mapSubStatus(
    s: AsaasSubscriptionStatus,
    deleted?: boolean,
  ): GatewaySubscriptionStatus {
    if (deleted) return 'canceled';
    switch (s) {
      case 'ACTIVE':
        return 'active';
      case 'INACTIVE':
        return 'canceled';
      case 'EXPIRED':
        return 'expired';
      default:
        return 'incomplete';
    }
  }

  private mapPaymentStatus(
    s: AsaasPaymentStatus,
    deleted?: boolean,
  ): GatewayInvoiceStatus {
    if (deleted) return 'canceled';
    switch (s) {
      case 'PENDING':
      case 'AWAITING_RISK_ANALYSIS':
        return 'pending';
      case 'CONFIRMED':
      case 'RECEIVED':
      case 'RECEIVED_IN_CASH':
        return 'paid';
      case 'OVERDUE':
        return 'overdue';
      case 'REFUNDED':
      case 'REFUND_IN_PROGRESS':
      case 'REFUND_REQUESTED':
        return 'refunded';
      case 'DELETED':
        return 'canceled';
      case 'CHARGEBACK_REQUESTED':
      case 'CHARGEBACK_DISPUTE':
      case 'AWAITING_CHARGEBACK_REVERSAL':
        return 'failed';
      case 'DUNNING_REQUESTED':
      case 'DUNNING_RECEIVED':
        return 'pending';
      default:
        return 'pending';
    }
  }

  private mapAsaasPaymentEvent(
    e: AsaasWebhookEventType,
  ): NormalizedWebhookEventType {
    switch (e) {
      case 'PAYMENT_CREATED':
        return 'invoice.created';
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_RECEIVED_IN_CASH':
        return 'invoice.paid';
      case 'PAYMENT_OVERDUE':
        return 'invoice.overdue';
      case 'PAYMENT_REFUNDED':
        return 'invoice.refunded';
      case 'PAYMENT_DELETED':
        return 'invoice.failed';
      case 'PAYMENT_REPROVED_BY_RISK_ANALYSIS':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
        return 'invoice.failed';
      default:
        return 'unknown';
    }
  }

  private mapAsaasSubscriptionEvent(
    e: AsaasWebhookEventType,
  ): NormalizedWebhookEventType {
    switch (e) {
      case 'SUBSCRIPTION_CREATED':
        return 'subscription.created';
      case 'SUBSCRIPTION_UPDATED':
        return 'subscription.updated';
      case 'SUBSCRIPTION_DELETED':
        return 'subscription.canceled';
      default:
        return 'unknown';
    }
  }

  private toAsaasCycle(c: GatewayBillingCycle): AsaasSubscriptionCycle {
    return c === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
  }

  private fromAsaasCycle(c: AsaasSubscriptionCycle): GatewayBillingCycle {
    return c === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
  }

  private centsToReais(cents: number): number {
    return Math.round(cents) / 100;
  }

  private reaisToCents(value: number): number {
    return Math.round(Number(value) * 100);
  }

  private formatDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private extractHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        const v = headers[key];
        if (Array.isArray(v)) return v[0] ?? null;
        return v ?? null;
      }
    }
    return null;
  }

  private makeEventId(eventType: string, resourceId: string): string {
    // Asaas n\u00e3o envia ID de evento; usamos a tupla (event, resourceId) para
    // idempot\u00eancia. O `webhook-handler` armazena junto com o timestamp para
    // deduplicar reentregas idempotentes.
    return `${eventType}:${resourceId}`;
  }
}
