export type GatewayProviderId = 'stripe';

export type GatewaySubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'incomplete';

export type GatewayBillingCycle = 'MONTHLY' | 'YEARLY';

export interface GatewayCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
  raw?: unknown;
}

export interface GatewayDiscount {
  name: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: 'once' | 'repeating' | 'forever' | null;
  endsAt?: Date | null;
}

export interface GatewayPaymentSummary {
  hasPaymentMethod: boolean;
  brand: string | null;
  last4: string | null;
}

export interface GatewaySubscription {
  id: string;
  customerId: string;
  status: GatewaySubscriptionStatus;
  providerStatus?: string;
  cycle: GatewayBillingCycle;
  amountCents: number;
  nextDueDate: Date | null;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt?: Date | null;
  canceledAt: Date | null;
  discount?: GatewayDiscount | null;
  raw?: unknown;
}

export interface GatewayCheckoutSession {
  id: string;
  url: string;
  raw?: unknown;
}

export interface GatewayBillingPortalSession {
  url: string;
  raw?: unknown;
}

export type NormalizedWebhookEventType =
  | 'checkout.completed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.paid'
  | 'invoice.failed'
  | 'invoice.overdue'
  | 'invoice.finalized'
  | 'invoice.voided'
  | 'unknown';

export type GatewayInvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'void'
  | 'uncollectible';

export interface GatewayInvoice {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: GatewayInvoiceStatus;
  amountDueCents: number;
  amountPaidCents: number;
  amountDiscountCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  hostedInvoiceUrl: string | null;
  couponCode: string | null;
  createdAt: Date;
}

export interface ListGatewayInvoicesParams {
  createdFrom?: Date;
  startingAfter?: string;
  limit: number;
}

export interface GatewayInvoicePage {
  items: GatewayInvoice[];
  hasMore: boolean;
  nextStartingAfter: string | null;
}

export interface GatewayInvoicePreview {
  amountDueCents: number;
  currency: string;
}

export interface GatewayPrice {
  id: string;
  unitAmountCents: number | null;
  cycle: GatewayBillingCycle | null;
  currency: string;
  active: boolean;
  productId: string | null;
}

export type GatewayCouponDuration = 'once' | 'repeating' | 'forever';

export interface CreateCouponInput {
  code: string;
  percentOff?: number;
  amountOffCents?: number;
  duration: GatewayCouponDuration;
  durationInMonths?: number;
  maxRedemptions?: number;
  redeemBy?: Date;
  appliesToPriceIds?: string[];
}

export interface GatewayCoupon {
  id: string;
  couponId: string;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string | null;
  duration: GatewayCouponDuration;
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: Date | null;
  active: boolean;
  valid: boolean;
  appliesToProductIds: string[];
  createdAt: Date;
}

export interface GatewayCouponPage {
  items: GatewayCoupon[];
  hasMore: boolean;
}

export interface NormalizedWebhookEvent {
  eventId: string;
  type: NormalizedWebhookEventType;
  resourceId: string;
  occurredAt: Date;
  raw: unknown;
  invoice?: GatewayInvoice;
  refs?: {
    subscriptionId?: string;
    invoiceId?: string;
    customerId?: string;
    checkoutSessionId?: string;
  };
}

export interface CreateCustomerInput {
  ownerId: string;
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
}

export interface CreateCheckoutSessionInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  subscriptionId: string;
  trialEnd?: Date | null;
}

export interface CreateBillingPortalSessionInput {
  customerId: string;
  returnUrl: string;
  subscriptionUpdate?: {
    subscriptionId: string;
    priceId: string;
  };
}

export interface VerifyWebhookInput {
  payload: unknown;
  headers: Record<string, string | string[] | undefined>;
}
