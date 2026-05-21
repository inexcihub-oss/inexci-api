/**
 * Tipos compartilhados pela camada gen\u00e9rica de gateway de pagamento.
 * Cada provider (Asaas, Stripe, etc.) deve normalizar suas respostas para
 * estes shapes, garantindo que o restante do sistema permane\u00e7a agn\u00f3stico
 * ao gateway.
 */

export type GatewayProviderId = 'stripe';

/** Status normalizado de uma assinatura no gateway. */
export type GatewaySubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'incomplete';

/** Status normalizado de uma fatura/cobran\u00e7a no gateway. */
export type GatewayInvoiceStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'overdue'
  | 'refunded'
  | 'canceled';

/** Periodicidade da cobran\u00e7a recorrente. */
export type GatewayBillingCycle = 'MONTHLY' | 'YEARLY';

/** Cliente normalizado. */
export interface GatewayCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
  raw?: unknown;
}

/** M\u00e9todo de pagamento normalizado (cart\u00e3o tokenizado). */
export interface GatewayPaymentMethod {
  /** Token/ID que substitui o cart\u00e3o real para futuras cobran\u00e7as. */
  token: string;
  brand: string;
  last4: string;
  holderName: string;
  expMonth: number;
  expYear: number;
  raw?: unknown;
}

/** Assinatura normalizada. */
export interface GatewaySubscription {
  id: string;
  customerId: string;
  status: GatewaySubscriptionStatus;
  cycle: GatewayBillingCycle;
  amountCents: number;
  nextDueDate: Date | null;
  raw?: unknown;
}

/** Fatura normalizada. */
export interface GatewayInvoice {
  id: string;
  subscriptionId: string | null;
  customerId: string;
  amountCents: number;
  status: GatewayInvoiceStatus;
  dueDate: Date;
  paidAt: Date | null;
  invoiceUrl: string | null;
  raw?: unknown;
}

/**
 * Tipos normalizados de eventos de webhook.
 * Cada provider mapeia seus eventos nativos para um destes valores.
 * Um payload n\u00e3o reconhecido vira `unknown` (e \u00e9 ignorado pelo handler).
 */
export type NormalizedWebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.failed'
  | 'invoice.overdue'
  | 'invoice.refunded'
  | 'unknown';

export interface NormalizedWebhookEvent {
  /** Identificador \u00fanico do evento no provider (para idempot\u00eancia). */
  eventId: string;
  type: NormalizedWebhookEventType;
  /** ID nativo do recurso afetado (subscription/invoice/customer). */
  resourceId: string;
  occurredAt: Date;
  raw: unknown;
  /** Refer\u00eancias \u00fateis para o handler localizar a entidade local. */
  refs?: {
    subscriptionId?: string;
    invoiceId?: string;
    customerId?: string;
  };
}

// ───── Inputs ─────

export interface CreateCustomerInput {
  ownerId: string;
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
}

export interface TokenizeCardInput {
  customerId: string;
  /** PaymentMethod ID criado pelo Stripe.js no frontend (pm_xxx). */
  paymentMethodId: string;
  brand: string;
  last4: string;
  holderName: string;
  expMonth: number;
  expYear: number;
}

export interface CreateSubscriptionInput {
  customerId: string;
  /** Token do cart\u00e3o previamente tokenizado. */
  paymentMethodToken: string;
  /** Valor a ser cobrado (em centavos). */
  amountCents: number;
  cycle: GatewayBillingCycle;
  /** Data da primeira cobran\u00e7a. */
  nextDueDate: Date;
  /** Descri\u00e7\u00e3o que aparece para o cliente (fatura/extrato). */
  description: string;
  /** ID interno da assinatura (para correla\u00e7\u00e3o nos webhooks). */
  externalReference: string;
}

export interface UpdateSubscriptionInput {
  amountCents?: number;
  cycle?: GatewayBillingCycle;
  nextDueDate?: Date;
  description?: string;
}

export interface CancelSubscriptionInput {
  /** Se true, mant\u00e9m at\u00e9 o final do per\u00edodo (n\u00e3o reembolsa). */
  atPeriodEnd: boolean;
}

export interface VerifyWebhookInput {
  /** Payload bruto recebido. */
  payload: unknown;
  /** Cabe\u00e7alhos da requisi\u00e7\u00e3o (para extrair assinatura/token). */
  headers: Record<string, string | string[] | undefined>;
}
