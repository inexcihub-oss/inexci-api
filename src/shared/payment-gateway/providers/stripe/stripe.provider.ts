import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import StripeLib = require('stripe');
import type { Customer as StripeCustomer } from 'stripe/cjs/resources/Customers';
import type { DeletedCustomer as StripeDeletedCustomer } from 'stripe/cjs/resources/Customers';
import type { Subscription as StripeSubscription } from 'stripe/cjs/resources/Subscriptions';
import type { Event as StripeEvent } from 'stripe/cjs/resources/Events';
import type { Invoice as StripeInvoice } from 'stripe/cjs/resources/Invoices';
import type { Price as StripePrice } from 'stripe/cjs/resources/Prices';
import type { Coupon as StripeCoupon } from 'stripe/cjs/resources/Coupons';
import type { PromotionCode as StripePromotionCode } from 'stripe/cjs/resources/PromotionCodes';
import type {
  DeletedDiscount as StripeDeletedDiscount,
  Discount as StripeDiscount,
} from 'stripe/cjs/resources/Discounts';

import {
  PaymentGateway,
  PaymentGatewayError,
} from '../../payment-gateway.interface';
import {
  CreateBillingPortalSessionInput,
  CreateCheckoutSessionInput,
  CreateCouponInput,
  CreateCustomerInput,
  GatewayBillingPortalSession,
  GatewayCheckoutSession,
  GatewayCoupon,
  GatewayCouponPage,
  GatewayCustomer,
  GatewayDiscount,
  GatewayInvoice,
  GatewayInvoicePage,
  GatewayInvoicePreview,
  GatewayInvoiceStatus,
  GatewayPaymentSummary,
  GatewayPrice,
  GatewayProviderId,
  GatewaySubscription,
  GatewaySubscriptionStatus,
  ListGatewayInvoicesParams,
  NormalizedWebhookEvent,
  NormalizedWebhookEventType,
  VerifyWebhookInput,
} from '../../payment-gateway.types';

type StripeInstance = StripeLib.Stripe;
type StripeSubStatus = StripeSubscription['status'];
type BillingPortalSessionCreateParams = NonNullable<
  Parameters<StripeInstance['billingPortal']['sessions']['create']>[0]
>;
type InvoiceListParams = NonNullable<
  Parameters<StripeInstance['invoices']['list']>[0]
>;
type BillingPortalFlowData = NonNullable<
  BillingPortalSessionCreateParams['flow_data']
>;

const COUPON_PAGE_SIZE = 50;
const COUPON_LIST_MAX_ITEMS = 100;
const COUPON_CURRENCY = 'brl';

const INVOICE_EXPAND = ['discounts.source.coupon', 'discounts.promotion_code'];

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
      apiVersion: '2026-06-24.dahlia',
      timeout: timeoutMs,
      appInfo: { name: 'inexci-api', version: '1.0' },
    });
  }

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

  async getCustomerPaymentSummary(
    customerId: string,
  ): Promise<GatewayPaymentSummary> {
    const none: GatewayPaymentSummary = {
      hasPaymentMethod: false,
      brand: null,
      last4: null,
    };
    try {
      const customer = await this.stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method'],
      });
      if ((customer as StripeDeletedCustomer).deleted) return none;
      const fromDefault = this.cardOf(
        (customer as StripeCustomer).invoice_settings?.default_payment_method,
      );
      if (fromDefault) return fromDefault;

      const list = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
        limit: 1,
      });
      return this.cardOf(list.data[0]) ?? none;
    } catch (err) {
      if (this.isNotFound(err)) return none;
      throw this.wrapError(err);
    }
  }

  private cardOf(method: unknown): GatewayPaymentSummary | null {
    if (!method || typeof method === 'string') return null;
    const card = (
      method as { card?: { brand?: string | null; last4?: string | null } }
    ).card;
    if (!card) return null;
    return {
      hasPaymentMethod: true,
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
    };
  }

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
        allow_promotion_codes: true,
        subscription_data: subscriptionData,
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
        ...(input.subscriptionUpdate
          ? {
              flow_data: await this.buildSubscriptionUpdateFlow(
                input.subscriptionUpdate,
              ),
            }
          : {}),
      });
      return { url: session.url, raw: session };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async buildSubscriptionUpdateFlow(update: {
    subscriptionId: string;
    priceId: string;
  }): Promise<BillingPortalFlowData> {
    const sub = await this.stripe.subscriptions.retrieve(update.subscriptionId);
    const item = sub.items?.data?.[0];
    if (!item) {
      throw new PaymentGatewayError(
        `Assinatura ${update.subscriptionId} não tem itens para trocar`,
        'subscription_without_items',
      );
    }

    return {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: update.subscriptionId,
        items: [
          { id: item.id, price: update.priceId, quantity: item.quantity ?? 1 },
        ],
      },
    };
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

  async getSubscriptionWithDiscount(
    subscriptionId: string,
  ): Promise<GatewaySubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['discounts.source.coupon'],
      });
      return this.toGatewaySubscription(sub);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  async getLatestSubscriptionByCustomer(
    customerId: string,
  ): Promise<GatewaySubscription | null> {
    try {
      const list = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 10,
      });

      if (!list.data.length) return null;

      const score = (status: StripeSubStatus): number => {
        switch (status) {
          case 'active':
          case 'trialing':
            return 5;
          case 'past_due':
          case 'unpaid':
            return 4;
          case 'incomplete':
            return 3;
          case 'paused':
            return 2;
          case 'canceled':
          case 'incomplete_expired':
          default:
            return 1;
        }
      };

      const best = [...list.data].sort((a, b) => {
        const statusDelta = score(b.status) - score(a.status);
        if (statusDelta !== 0) return statusDelta;
        return (b.created ?? 0) - (a.created ?? 0);
      })[0];

      return best ? this.toGatewaySubscription(best) : null;
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  async updateTrialEnd(
    subscriptionId: string,
    trialEnd: Date,
    idempotencyKey: string,
  ): Promise<GatewaySubscription> {
    try {
      const sub = await this.stripe.subscriptions.update(
        subscriptionId,
        {
          trial_end: Math.floor(trialEnd.getTime() / 1000),
          proration_behavior: 'none',
        },
        { idempotencyKey },
      );
      return this.toGatewaySubscription(sub);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async listInvoices(
    params: ListGatewayInvoicesParams,
  ): Promise<GatewayInvoicePage> {
    try {
      const query: InvoiceListParams = {
        limit: params.limit,
        expand: INVOICE_EXPAND.map((path) => `data.${path}`),
      };
      if (params.startingAfter) query.starting_after = params.startingAfter;
      if (params.createdFrom) {
        query.created = {
          gte: Math.floor(params.createdFrom.getTime() / 1000),
        };
      }
      const list = await this.stripe.invoices.list(query);
      const items = list.data.map((inv) => this.toGatewayInvoice(inv));
      return {
        items,
        hasMore: list.has_more,
        nextStartingAfter:
          list.has_more && items.length ? items[items.length - 1].id : null,
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getInvoice(invoiceId: string): Promise<GatewayInvoice | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        expand: INVOICE_EXPAND,
      });
      return this.toGatewayInvoice(invoice);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  async previewNextInvoice(
    subscriptionId: string,
  ): Promise<GatewayInvoicePreview | null> {
    try {
      const preview = await this.stripe.invoices.createPreview({
        subscription: subscriptionId,
      });
      return {
        amountDueCents: preview.amount_due,
        currency: preview.currency.toUpperCase(),
      };
    } catch (err) {
      if (this.isNoUpcomingInvoice(err)) return null;
      throw this.wrapError(err);
    }
  }

  async getPrice(priceId: string): Promise<GatewayPrice | null> {
    try {
      const price = await this.stripe.prices.retrieve(priceId);
      return this.toGatewayPrice(price);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  async createCoupon(
    input: CreateCouponInput,
    idempotencyKey: string,
  ): Promise<GatewayCoupon> {
    try {
      const existing = await this.stripe.promotionCodes.list({
        code: input.code,
        active: true,
        limit: 1,
      });
      if (existing.data.length > 0) throw this.duplicateCouponError(input.code);

      const productIds = await this.productIdsOf(input.appliesToPriceIds);

      const coupon = await this.stripe.coupons.create(
        {
          name: input.code,
          duration: input.duration,
          ...(input.percentOff !== undefined
            ? { percent_off: input.percentOff }
            : { amount_off: input.amountOffCents, currency: COUPON_CURRENCY }),
          ...(input.durationInMonths !== undefined
            ? { duration_in_months: input.durationInMonths }
            : {}),
          ...(productIds.length
            ? { applies_to: { products: productIds } }
            : {}),
          expand: ['applies_to'],
        },
        { idempotencyKey: `${idempotencyKey}:coupon` },
      );

      try {
        const promo = await this.stripe.promotionCodes.create(
          {
            promotion: { type: 'coupon', coupon: coupon.id },
            code: input.code,
            ...(input.maxRedemptions !== undefined
              ? { max_redemptions: input.maxRedemptions }
              : {}),
            ...(input.redeemBy
              ? { expires_at: Math.floor(input.redeemBy.getTime() / 1000) }
              : {}),
          },
          { idempotencyKey: `${idempotencyKey}:promo` },
        );
        return this.toGatewayCoupon(promo, coupon);
      } catch (err) {
        await this.discardCoupon(coupon.id);
        throw err;
      }
    } catch (err) {
      if (err instanceof PaymentGatewayError) throw err;
      if (this.isDuplicateCode(err))
        throw this.duplicateCouponError(input.code);
      throw this.wrapError(err);
    }
  }

  async listCoupons(
    maxItems: number = COUPON_LIST_MAX_ITEMS,
  ): Promise<GatewayCouponPage> {
    try {
      const items: GatewayCoupon[] = [];
      let hasMore = false;
      let startingAfter: string | undefined;
      while (items.length < maxItems) {
        const limit = Math.min(COUPON_PAGE_SIZE, maxItems - items.length);
        const page = await this.stripe.promotionCodes.list({
          limit,
          expand: ['data.promotion.coupon.applies_to'],
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const promo of page.data) items.push(this.toGatewayCoupon(promo));
        const last = page.data[page.data.length - 1];
        hasMore = Boolean(page.has_more) && Boolean(last);
        if (!hasMore) break;
        startingAfter = last.id;
      }
      return { items, hasMore };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCoupon(promotionCodeId: string): Promise<GatewayCoupon | null> {
    try {
      const promo = await this.stripe.promotionCodes.retrieve(promotionCodeId, {
        expand: ['promotion.coupon.applies_to'],
      });
      return this.toGatewayCoupon(promo);
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw this.wrapError(err);
    }
  }

  async deactivateCoupon(
    promotionCodeId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.stripe.promotionCodes.update(
        promotionCodeId,
        { active: false },
        { idempotencyKey },
      );
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async productIdsOf(
    priceIds: string[] | undefined,
  ): Promise<string[]> {
    const products = new Set<string>();
    for (const priceId of priceIds ?? []) {
      const price = await this.stripe.prices.retrieve(priceId);
      const productId = this.productIdOf(price);
      if (!productId) {
        throw new PaymentGatewayError(
          `Preço ${priceId} sem produto na Stripe`,
          'PRICE_WITHOUT_PRODUCT',
          400,
        );
      }
      products.add(productId);
    }
    return [...products];
  }

  private productIdOf(price: StripePrice): string | null {
    const product = price.product as unknown;
    if (!product) return null;
    if (typeof product === 'string') return product;
    return (product as { id?: string }).id ?? null;
  }

  private async discardCoupon(couponId: string): Promise<void> {
    try {
      await this.stripe.coupons.del(couponId);
    } catch (err) {
      this.logger.warn(
        `Cupom órfão ${couponId} não pôde ser removido: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private duplicateCouponError(code: string): PaymentGatewayError {
    return new PaymentGatewayError(
      `Já existe um código promocional ativo "${code}" na Stripe`,
      'COUPON_CODE_DUPLICATE',
      409,
    );
  }

  private isDuplicateCode(err: unknown): boolean {
    if (!(err instanceof StripeLib.errors.StripeError)) return false;
    return (
      err.code === 'resource_already_exists' ||
      /already exists|already.*promotion code/i.test(err.message)
    );
  }

  private toGatewayCoupon(
    promo: StripePromotionCode,
    couponOverride?: StripeCoupon,
  ): GatewayCoupon {
    const embedded = promo.promotion?.coupon;
    const coupon =
      couponOverride ??
      (embedded && typeof embedded !== 'string' ? embedded : null);
    return {
      id: promo.id,
      couponId:
        coupon?.id ?? (typeof embedded === 'string' ? embedded : promo.id),
      code: promo.code,
      percentOff: coupon?.percent_off ?? null,
      amountOffCents: coupon?.amount_off ?? null,
      currency: coupon?.currency ? coupon.currency.toUpperCase() : null,
      duration: coupon?.duration ?? 'once',
      durationInMonths: coupon?.duration_in_months ?? null,
      maxRedemptions: promo.max_redemptions ?? null,
      timesRedeemed: promo.times_redeemed ?? 0,
      expiresAt: promo.expires_at ? new Date(promo.expires_at * 1000) : null,
      active: promo.active,
      valid: coupon?.valid ?? promo.active,
      appliesToProductIds: coupon?.applies_to?.products ?? [],
      createdAt: new Date(promo.created * 1000),
    };
  }

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

    const invoice = event.type.startsWith('invoice.')
      ? this.safeInvoiceOf(event)
      : undefined;

    return {
      eventId: event.id,
      type,
      resourceId,
      occurredAt,
      raw: event,
      refs,
      ...(invoice ? { invoice } : {}),
    };
  }

  private safeInvoiceOf(event: StripeEvent): GatewayInvoice | undefined {
    try {
      return this.toGatewayInvoice(event.data.object as StripeInvoice);
    } catch (err) {
      this.logger.warn(
        `[webhook] fatura do evento ${event.id} (${event.type}) não pôde ser normalizada: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  private toGatewayInvoice(inv: StripeInvoice): GatewayInvoice {
    const toDate = (ts: number | null | undefined): Date | null =>
      ts ? new Date(ts * 1000) : null;
    const customer = inv.customer;
    const parentSub = inv.parent?.subscription_details?.subscription ?? null;
    return {
      id: inv.id,
      customerId:
        typeof customer === 'string' ? customer : (customer?.id ?? null),
      subscriptionId:
        typeof parentSub === 'string' ? parentSub : (parentSub?.id ?? null),
      status: this.mapInvoiceStatus(inv.status),
      amountDueCents: inv.amount_due ?? 0,
      amountPaidCents: inv.amount_paid ?? 0,
      amountDiscountCents: (inv.total_discount_amounts ?? []).reduce(
        (sum, d) => sum + (d.amount ?? 0),
        0,
      ),
      currency: (inv.currency ?? '').toUpperCase(),
      periodStart: toDate(inv.period_start),
      periodEnd: toDate(inv.period_end),
      dueDate: toDate(inv.due_date),
      paidAt: toDate(inv.status_transitions?.paid_at),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      couponCode: this.couponCodeOf(inv.discounts ?? []),
      createdAt: toDate(inv.created) ?? new Date(),
    };
  }

  private couponCodeOf(
    discounts: Array<string | StripeDiscount | StripeDeletedDiscount>,
  ): string | null {
    for (const discount of discounts) {
      if (typeof discount === 'string') continue;
      const promo = discount.promotion_code;
      if (promo && typeof promo !== 'string' && promo.code) {
        return promo.code.slice(0, 100);
      }
      const coupon = discount.source?.coupon;
      if (coupon && typeof coupon !== 'string') {
        return (coupon.name || coupon.id).slice(0, 100);
      }
    }
    return null;
  }

  private mapInvoiceStatus(
    status: StripeInvoice['status'],
  ): GatewayInvoiceStatus {
    switch (status) {
      case 'open':
      case 'paid':
      case 'void':
      case 'uncollectible':
        return status;
      default:
        return 'draft';
    }
  }

  private toGatewayPrice(price: StripePrice): GatewayPrice {
    const recurring = price.recurring;
    let cycle: GatewayPrice['cycle'] = null;
    if (recurring && recurring.interval_count === 1) {
      if (recurring.interval === 'month') cycle = 'MONTHLY';
      if (recurring.interval === 'year') cycle = 'YEARLY';
    }
    return {
      id: price.id,
      unitAmountCents: price.unit_amount ?? null,
      cycle,
      currency: (price.currency ?? '').toUpperCase(),
      active: price.active,
      productId: this.productIdOf(price),
    };
  }

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
      providerStatus: s.status,
      cycle: interval === 'year' ? 'YEARLY' : 'MONTHLY',
      amountCents: amountCents ?? 0,
      nextDueDate: nextDueDateTs ? new Date(nextDueDateTs * 1000) : null,
      priceId: item?.price?.id ?? null,
      currentPeriodStart: periodStartTs ? new Date(periodStartTs * 1000) : null,
      currentPeriodEnd: periodEndTs ? new Date(periodEndTs * 1000) : null,
      trialEndsAt: s.trial_end ? new Date(s.trial_end * 1000) : null,
      cancelAtPeriodEnd: s.cancel_at_period_end ?? false,
      cancelAt: s.cancel_at ? new Date(s.cancel_at * 1000) : null,
      discount: this.toGatewayDiscount(s),
      canceledAt: (rawSub['canceled_at'] as number | null | undefined)
        ? new Date((rawSub['canceled_at'] as number) * 1000)
        : null,
      raw: s,
    };
  }

  private toGatewayDiscount(
    s: StripeSubscription,
  ): GatewayDiscount | null | undefined {
    const discounts = s.discounts ?? [];
    if (!discounts.length) return null;
    const first = discounts.find((d) => typeof d !== 'string');
    if (!first || typeof first === 'string') return undefined;
    const coupon = first.source?.coupon;
    if (!coupon || typeof coupon === 'string') return undefined;
    return {
      name: coupon.name ?? null,
      percentOff: coupon.percent_off ?? null,
      amountOffCents: coupon.amount_off ?? null,
      duration: coupon.duration ?? null,
      endsAt: first.end ? new Date(first.end * 1000) : null,
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
      case 'invoice.finalized':
        return 'invoice.finalized';
      case 'invoice.voided':
        return 'invoice.voided';
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

    if (event.type.startsWith('customer.subscription.')) {
      return {
        resourceId: id,
        refs: {
          subscriptionId: id,
          customerId: (obj['customer'] as string) ?? undefined,
        },
      };
    }

    if (event.type.startsWith('invoice.')) {
      return {
        resourceId: id,
        refs: {
          invoiceId: id,
          subscriptionId: this.invoiceSubscriptionRef(obj),
          customerId:
            typeof obj['customer'] === 'string' ? obj['customer'] : undefined,
        },
      };
    }

    return { resourceId: id, refs: undefined };
  }

  private invoiceSubscriptionRef(
    obj: Record<string, unknown>,
  ): string | undefined {
    const refOf = (value: unknown): string | undefined => {
      if (typeof value === 'string' && value) return value;
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>)['id'];
        if (typeof nested === 'string' && nested) return nested;
      }
      return undefined;
    };
    const parent = obj['parent'];
    if (parent && typeof parent === 'object') {
      const details = (parent as Record<string, unknown>)[
        'subscription_details'
      ];
      if (details && typeof details === 'object') {
        const fromParent = refOf(
          (details as Record<string, unknown>)['subscription'],
        );
        if (fromParent) return fromParent;
      }
    }
    return refOf(obj['subscription']);
  }

  private isNoUpcomingInvoice(err: unknown): boolean {
    return (
      err instanceof StripeLib.errors.StripeError &&
      (err.statusCode === 400 || err.statusCode === 404)
    );
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
