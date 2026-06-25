import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- SDK Stripe usa namespace CJS com errors.StripeError
import StripeLib = require('stripe');
import type { Customer as StripeCustomer } from 'stripe/cjs/resources/Customers';
import type { DeletedCustomer as StripeDeletedCustomer } from 'stripe/cjs/resources/Customers';
import type { Subscription as StripeSubscription } from 'stripe/cjs/resources/Subscriptions';
import type { Event as StripeEvent } from 'stripe/cjs/resources/Events';

import {
  PaymentGateway,
  PaymentGatewayError,
} from '../../payment-gateway.interface';
import {
  CreateBillingPortalSessionInput,
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  GatewayBillingPortalSession,
  GatewayCheckoutSession,
  GatewayCustomer,
  GatewayProviderId,
  GatewaySubscription,
  GatewaySubscriptionStatus,
  NormalizedWebhookEvent,
  NormalizedWebhookEventType,
  VerifyWebhookInput,
} from '../../payment-gateway.types';

type StripeInstance = StripeLib.Stripe;
type StripeSubStatus = StripeSubscription['status'];

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

  // ───── Checkout / Portal ─────

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<GatewayCheckoutSession> {
    try {
      const subscriptionData: Record<string, unknown> = {
        metadata: { subscriptionId: input.subscriptionId },
      };

      if (input.trialEnd) {
        subscriptionData['trial_end'] = Math.floor(
          input.trialEnd.getTime() / 1000,
        );
      }

      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        subscription_data: subscriptionData as StripeLib.Stripe.Checkout.SessionCreateParams.SubscriptionData,
      });

      return { id: session.id, url: session.url ?? '', raw: session };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createBillingPortalSession(
    input: CreateBillingPortalSessionInput,
  ): Promise<GatewayBillingPortalSession> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url, raw: session };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ───── Subscriptions ─────

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
    const nextDueDateTs = s.billing_cycle_anchor ?? null;

    // API 2026-04-22.dahlia moved current_period_start/end to the item level.
    const rawItem = item as unknown as Record<string, unknown>;
    const rawSub = s as unknown as Record<string, unknown>;
    const periodStartTs =
      (rawItem['current_period_start'] as number | undefined) ??
      (rawSub['current_period_start'] as number | undefined) ??
      null;
    const periodEndTs =
      (rawItem['current_period_end'] as number | undefined) ??
      (rawSub['current_period_end'] as number | undefined) ??
      null;

    return {
      id: s.id,
      customerId: s.customer as string,
      status: this.mapSubStatus(s.status, s.cancel_at_period_end),
      cycle: interval === 'year' ? 'YEARLY' : 'MONTHLY',
      amountCents: amountCents ?? 0,
      nextDueDate: nextDueDateTs ? new Date(nextDueDateTs * 1000) : null,
      priceId: item?.price?.id ?? null,
      currentPeriodStart: periodStartTs ? new Date(periodStartTs * 1000) : null,
      currentPeriodEnd: periodEndTs ? new Date(periodEndTs * 1000) : null,
      trialEndsAt: s.trial_end ? new Date(s.trial_end * 1000) : null,
      cancelAtPeriodEnd: s.cancel_at_period_end ?? false,
      canceledAt: (rawSub['canceled_at'] as number | null | undefined)
        ? new Date((rawSub['canceled_at'] as number) * 1000)
        : null,
      raw: s,
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

  private mapStripeEvent(type: string): NormalizedWebhookEventType {
    switch (type) {
      case 'checkout.session.completed':
        return 'checkout.completed';
      case 'customer.subscription.created':
        return 'subscription.created';
      case 'customer.subscription.updated':
        return 'subscription.updated';
      case 'customer.subscription.deleted':
        return 'subscription.canceled';
      case 'invoice.payment_succeeded':
        return 'invoice.paid';
      case 'invoice.payment_failed':
        return 'invoice.failed';
      case 'invoice.marked_uncollectible':
        return 'invoice.overdue';
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

    // Checkout session events
    if (event.type === 'checkout.session.completed') {
      return {
        resourceId: id,
        refs: {
          checkoutSessionId: id,
          subscriptionId:
            typeof obj['subscription'] === 'string'
              ? obj['subscription']
              : undefined,
          customerId:
            typeof obj['customer'] === 'string' ? obj['customer'] : undefined,
        },
      };
    }

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
            typeof obj['customer'] === 'string' ? obj['customer'] : undefined,
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
