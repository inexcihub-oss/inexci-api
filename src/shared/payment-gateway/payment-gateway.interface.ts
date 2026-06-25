import {
  CreateBillingPortalSessionInput,
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  GatewayBillingPortalSession,
  GatewayCheckoutSession,
  GatewayCustomer,
  GatewayProviderId,
  GatewaySubscription,
  NormalizedWebhookEvent,
  VerifyWebhookInput,
} from './payment-gateway.types';

/**
 * Token de DI para resolução do provider ativo (configurado via env).
 * O módulo `PaymentGatewayModule` registra a implementação concreta
 * (Stripe) sob este token.
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Contrato genérico para integração com gateways de pagamento.
 *
 * Toda implementação deve normalizar respostas para os tipos compartilhados
 * em `payment-gateway.types.ts`. Erros do gateway devem ser propagados como
 * `PaymentGatewayError` (subclasse de Error com `code`, `httpStatus` e `raw`).
 */
export interface PaymentGateway {
  readonly providerId: GatewayProviderId;

  // ───── Customers ─────
  createCustomer(input: CreateCustomerInput): Promise<GatewayCustomer>;
  getCustomer(customerId: string): Promise<GatewayCustomer | null>;

  // ───── Checkout / Portal (Stripe Checkout + Customer Portal) ─────
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<GatewayCheckoutSession>;
  createBillingPortalSession(
    input: CreateBillingPortalSessionInput,
  ): Promise<GatewayBillingPortalSession>;

  // ───── Subscriptions ─────
  getSubscription(subscriptionId: string): Promise<GatewaySubscription | null>;

  // ───── Webhooks ─────
  /**
   * Verifica autenticidade do webhook (assinatura/token). Lança se inválido.
   */
  verifyWebhook(input: VerifyWebhookInput): void;
  /**
   * Normaliza o payload bruto do gateway para o shape interno.
   * Eventos não reconhecidos devolvem `type: 'unknown'`.
   */
  parseWebhookEvent(payload: unknown): NormalizedWebhookEvent;
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}
