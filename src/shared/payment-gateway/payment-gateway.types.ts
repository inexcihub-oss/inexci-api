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

export interface GatewaySubscription {
  id: string;
  customerId: string;
  status: GatewaySubscriptionStatus;
  cycle: GatewayBillingCycle;
  amountCents: number;
  nextDueDate: Date | null;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
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
  | 'unknown';

export interface NormalizedWebhookEvent {
  eventId: string;
  type: NormalizedWebhookEventType;
  resourceId: string;
  occurredAt: Date;
  raw: unknown;
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
