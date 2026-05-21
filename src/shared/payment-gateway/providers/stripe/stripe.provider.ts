import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeLib = require('stripe');
import type { Customer as StripeCustomer } from 'stripe/cjs/resources/Customers';
import type { DeletedCustomer as StripeDeletedCustomer } from 'stripe/cjs/resources/Customers';
import type { Subscription as StripeSubscription } from 'stripe/cjs/resources/Subscriptions';
import type { SubscriptionUpdateParams as StripeSubscriptionUpdateParams } from 'stripe/cjs/resources/Subscriptions';
import type { Invoice as StripeInvoice } from 'stripe/cjs/resources/Invoices';
import type { Event as StripeEvent } from 'stripe/cjs/resources/Events';

import {
  PaymentGateway,
  PaymentGatewayError,
} from '../../payment-gateway.interface';
import {
  CancelSubscriptionInput,
  CreateCustomerInput,
  CreateSubscriptionInput,
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

type StripeInstance = StripeLib.Stripe;
type StripeSubStatus = StripeSubscription['status'];
type StripeInvoiceStatus = StripeInvoice['status'];

@Injectable()
export class StripeProvider implements PaymentGateway {
  readonly providerId: GatewayProviderId = 'stripe';

  private readonly stripe: StripeInstance;
  private readonly logger = new Logger(StripeProvider.name);
  private readonly webhookSecret: string;
  private _lastVerifiedEvent: StripeEvent | null = null;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY', '');
    const timeoutMs = Number(
      this.config.get<number>('STRIPE_REQUEST_TIMEOUT_MS', 15000),
    );
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    this.stripe = new StripeLib(secretKey, {
      apiVersion: '2026-04-22.dahlia',
      timeout: timeoutMs,
      appInfo: { name: 'inexci-api', version: '1.0' },
    });
  }

  // ───── Customers ─────

  async createCustomer(input: CreateCustomerInput): Promise<GatewayCustomer> {
    try {
      const customer = await this.stripe.customers.create({
        name: input.name,
        email: input.email,
        phone: input.phone || undefined,
        metadata: { ownerId: input.ownerId },
      });
      return this.toGatewayCustomer(customer);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCustomer(customerId: string): Promise<GatewayCustomer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if ((customer as StripeDeletedCustomer).deleted) return null;
      return this.toGatewayCustomer(customer as StripeCustomer);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  // ───── Cartão ─────

  async tokenizeCard(input: TokenizeCardInput): Promise<GatewayPaymentMethod> {
    try {
      await this.stripe.paymentMethods.attach(input.paymentMethodId, {
        customer: input.customerId,
      });
      return {
        token: input.paymentMethodId,
        brand: input.brand,
        last4: input.last4,
        holderName: input.holderName,
        expMonth: input.expMonth,
        expYear: input.expYear,
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ───── Subscriptions ─────

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<GatewaySubscription> {
    try {
      const interval: 'year' | 'month' =
        input.cycle === 'YEARLY' ? 'year' : 'month';

      // Cria produto e preço inline via Prices API
      const price = await this.stripe.prices.create({
        currency: 'brl',
        unit_amount: input.amountCents,
        recurring: { interval },
        product_data: { name: input.description },
      });

      const sub = await this.stripe.subscriptions.create({
        customer: input.customerId,
        items: [{ price: price.id }],
        default_payment_method: input.paymentMethodToken,
        metadata: { externalReference: input.externalReference },
      });
      return this.toGatewaySubscription(sub);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<GatewaySubscription> {
    try {
      const params: StripeSubscriptionUpdateParams = {};
      if (input.description != null) {
        params.metadata = { description: input.description };
      }
      const sub = await this.stripe.subscriptions.update(
        subscriptionId,
        params,
      );
      return this.toGatewaySubscription(sub);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async cancelSubscription(
    subscriptionId: string,
    input: CancelSubscriptionInput,
  ): Promise<void> {
    try {
      if (input.atPeriodEnd) {
        await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      } else {
        await this.stripe.subscriptions.cancel(subscriptionId);
      }
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getSubscription(
    subscriptionId: string,
  ): Promise<GatewaySubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      return this.toGatewaySubscription(sub);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  // ───── Faturas ─────

  async getInvoice(invoiceId: string): Promise<GatewayInvoice | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      return this.toGatewayInvoice(invoice);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  async listInvoicesBySubscription(
    subscriptionId: string,
  ): Promise<GatewayInvoice[]> {
    try {
      const list = await this.stripe.invoices.list({
        subscription: subscriptionId,
        limit: 100,
      });
      return list.data.map((inv: StripeInvoice) => this.toGatewayInvoice(inv));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ───── Webhooks ─────

  verifyWebhook(input: VerifyWebhookInput): void {
    if (!this.webhookSecret) {
      throw new PaymentGatewayError(
        'STRIPE_WEBHOOK_SECRET não configurada — webhook rejeitado',
        'WEBHOOK_NOT_CONFIGURED',
        503,
      );
    }
    const sig = this.extractHeader(input.headers, 'stripe-signature');
    if (!sig) {
      throw new PaymentGatewayError(
        'Header stripe-signature ausente',
        'WEBHOOK_INVALID_SIGNATURE',
        401,
      );
    }
    try {
      this._lastVerifiedEvent = this.stripe.webhooks.constructEvent(
        input.payload as Buffer,
        sig,
        this.webhookSecret,
      );
    } catch (err) {
      this._lastVerifiedEvent = null;
      throw new PaymentGatewayError(
        `Assinatura de webhook Stripe inválida: ${err instanceof Error ? err.message : String(err)}`,
        'WEBHOOK_INVALID_SIGNATURE',
        401,
      );
    }
  }

  parseWebhookEvent(payload: unknown): NormalizedWebhookEvent {
    const event = (this._lastVerifiedEvent ?? payload) as StripeEvent;
    this._lastVerifiedEvent = null;

    if (!event || typeof event !== 'object' || !('type' in event)) {
      return {
        eventId: 'unknown',
        type: 'unknown',
        resourceId: '',
        occurredAt: new Date(),
        raw: payload,
      };
    }

    const occurredAt = new Date(event.created * 1000);
    const type = this.mapStripeEvent(event.type);
    const { resourceId, refs } = this.extractRefs(event);

    return {
      eventId: event.id,
      type,
      resourceId,
      occurredAt,
      raw: event,
      refs,
    };
  }

  // ───── Normalização ─────

  private toGatewayCustomer(c: StripeCustomer): GatewayCustomer {
    return {
      id: c.id,
      name: c.name ?? '',
      email: (typeof c.email === 'string' ? c.email : '') ?? '',
      phone: c.phone ?? null,
      raw: c,
    };
  }

  private toGatewaySubscription(s: StripeSubscription): GatewaySubscription {
    const item = s.items.data[0];
    const amountCents = item?.price?.unit_amount ?? 0;
    const interval = item?.price?.recurring?.interval;
    // current_period_end foi removido da API; usar billing_cycle_anchor como próxima data
    const nextDueDateTs = s.billing_cycle_anchor ?? null;
    return {
      id: s.id,
      customerId: s.customer as string,
      status: this.mapSubStatus(s.status, s.cancel_at_period_end),
      cycle: interval === 'year' ? 'YEARLY' : 'MONTHLY',
      amountCents: amountCents ?? 0,
      nextDueDate: nextDueDateTs ? new Date(nextDueDateTs * 1000) : null,
      raw: s,
    };
  }

  private toGatewayInvoice(inv: StripeInvoice): GatewayInvoice {
    // Na API 2026-04-22.dahlia, subscription está em inv.parent.subscription_details.subscription
    const subRef = inv.parent?.subscription_details?.subscription;
    const subscriptionId = typeof subRef === 'string' ? subRef : null;
    return {
      id: inv.id ?? '',
      subscriptionId,
      customerId: typeof inv.customer === 'string' ? inv.customer : '',
      amountCents: inv.amount_due,
      status: this.mapInvoiceStatus(inv.status),
      dueDate: inv.due_date
        ? new Date(inv.due_date * 1000)
        : new Date(inv.created * 1000),
      paidAt: inv.status_transitions?.paid_at
        ? new Date(inv.status_transitions.paid_at * 1000)
        : null,
      invoiceUrl: inv.hosted_invoice_url ?? null,
      raw: inv,
    };
  }

  private mapSubStatus(
    status: StripeSubStatus,
    cancelAtPeriodEnd: boolean,
  ): GatewaySubscriptionStatus {
    if (status === 'canceled') return 'canceled';
    if (status === 'active' && cancelAtPeriodEnd) return 'active';
    switch (status) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
      case 'unpaid':
        return 'past_due';
      case 'incomplete':
      case 'incomplete_expired':
        return 'incomplete';
      case 'paused':
        return 'past_due';
      default:
        return 'incomplete';
    }
  }

  private mapInvoiceStatus(
    status: StripeInvoiceStatus | null,
  ): GatewayInvoiceStatus {
    switch (status) {
      case 'draft':
      case 'open':
        return 'pending';
      case 'paid':
        return 'paid';
      case 'uncollectible':
        return 'overdue';
      case 'void':
        return 'canceled';
      default:
        return 'pending';
    }
  }

  private mapStripeEvent(type: string): NormalizedWebhookEventType {
    switch (type) {
      case 'customer.subscription.created':
        return 'subscription.created';
      case 'customer.subscription.updated':
        return 'subscription.updated';
      case 'customer.subscription.deleted':
        return 'subscription.canceled';
      case 'invoice.created':
        return 'invoice.created';
      case 'invoice.payment_succeeded':
        return 'invoice.paid';
      case 'invoice.payment_failed':
        return 'invoice.failed';
      case 'invoice.marked_uncollectible':
        return 'invoice.overdue';
      case 'charge.refunded':
        return 'invoice.refunded';
      default:
        return 'unknown';
    }
  }

  private extractRefs(event: StripeEvent): {
    resourceId: string;
    refs: NormalizedWebhookEvent['refs'];
  } {
    const obj = event.data.object as unknown as Record<string, unknown>;
    const id = (obj['id'] as string) ?? '';

    // Subscription events
    if (event.type.startsWith('customer.subscription.')) {
      return {
        resourceId: id,
        refs: {
          subscriptionId: id,
          customerId: (obj['customer'] as string) ?? undefined,
        },
      };
    }

    // Invoice events
    if (event.type.startsWith('invoice.')) {
      return {
        resourceId: id,
        refs: {
          invoiceId: id,
          subscriptionId:
            typeof obj['subscription'] === 'string'
              ? obj['subscription']
              : undefined,
          customerId:
            typeof obj['customer'] === 'string'
              ? obj['customer']
              : undefined,
        },
      };
    }

    // Charge events
    if (event.type.startsWith('charge.')) {
      return {
        resourceId: id,
        refs: {
          customerId:
            typeof obj['customer'] === 'string'
              ? obj['customer']
              : undefined,
        },
      };
    }

    return { resourceId: id, refs: undefined };
  }

  private isNotFound(err: unknown): boolean {
    return (
      err instanceof StripeLib.errors.StripeError && err.statusCode === 404
    );
  }

  private wrapError(err: unknown): PaymentGatewayError {
    if (err instanceof StripeLib.errors.StripeError) {
      return new PaymentGatewayError(
        err.message,
        err.code ?? 'STRIPE_ERROR',
        err.statusCode,
        err,
      );
    }
    return new PaymentGatewayError(
      err instanceof Error ? err.message : String(err),
      'STRIPE_UNKNOWN_ERROR',
    );
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
}
