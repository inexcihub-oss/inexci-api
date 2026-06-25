/**
 * Tipos compartilhados pela camada genérica de gateway de pagamento.
 * O provider Stripe deve normalizar suas respostas para
 * estes shapes, garantindo que o restante do sistema permaneça agnóstico
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

/** Periodicidade da cobrança recorrente. */
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

/** Assinatura normalizada. */
export interface GatewaySubscription {
  id: string;
  customerId: string;
  status: GatewaySubscriptionStatus;
  cycle: GatewayBillingCycle;
  amountCents: number;
  nextDueDate: Date | null;
  /** Stripe Price ID do item (usado para resolver o plano local). */
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  raw?: unknown;
}

/** Sessão de Checkout criada no gateway. */
export interface GatewayCheckoutSession {
  id: string;
  url: string;
  raw?: unknown;
}

/** Sessão do Customer Portal criada no gateway. */
export interface GatewayBillingPortalSession {
  url: string;
  raw?: unknown;
}

/**
 * Tipos normalizados de eventos de webhook.
 * Cada provider mapeia seus eventos nativos para um destes valores.
 * Um payload não reconhecido vira `unknown` (e é ignorado pelo handler).
 */
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
  /** Identificador único do evento no provider (para idempotência). */
  eventId: string;
  type: NormalizedWebhookEventType;
  /** ID nativo do recurso afetado (subscription/invoice/customer). */
  resourceId: string;
  occurredAt: Date;
  raw: unknown;
  /** Referências úteis para o handler localizar a entidade local. */
  refs?: {
    subscriptionId?: string;
    invoiceId?: string;
    customerId?: string;
    /** Stripe Checkout session ID (presente em checkout.completed). */
    checkoutSessionId?: string;
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

export interface CreateCheckoutSessionInput {
  customerId: string;
  /** Stripe Price ID do plano escolhido (gateway_price_id). */
  priceId: string;
  /** URL de redirecionamento após pagamento bem-sucedido. */
  successUrl: string;
  /** URL de redirecionamento se o usuário cancelar o Checkout. */
  cancelUrl: string;
  /** ID interno da subscription local (gravado em metadata). */
  subscriptionId: string;
  /**
   * Fim do trial em Unix timestamp.
   * Se fornecido, a cobrança começa após esta data.
   */
  trialEnd?: Date | null;
}

export interface CreateBillingPortalSessionInput {
  customerId: string;
  /** URL de retorno exibida no portal ("← Voltar para Inexci"). */
  returnUrl: string;
}

export interface VerifyWebhookInput {
  /** Payload bruto recebido. */
  payload: unknown;
  /** Cabeçalhos da requisição (para extrair assinatura/token). */
  headers: Record<string, string | string[] | undefined>;
}
