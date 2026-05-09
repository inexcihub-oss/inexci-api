import {
  CancelSubscriptionInput,
  CreateCustomerInput,
  CreateSubscriptionInput,
  GatewayCustomer,
  GatewayInvoice,
  GatewayPaymentMethod,
  GatewayProviderId,
  GatewaySubscription,
  NormalizedWebhookEvent,
  TokenizeCardInput,
  UpdateSubscriptionInput,
  VerifyWebhookInput,
} from './payment-gateway.types';

/**
 * Token de DI para resolu\u00e7\u00e3o do provider ativo (configurado via env).
 * O m\u00f3dulo `PaymentGatewayModule` registra a implementa\u00e7\u00e3o concreta
 * (atualmente Asaas) sob este token.
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Contrato gen\u00e9rico para integra\u00e7\u00e3o com gateways de pagamento.
 *
 * Toda implementa\u00e7\u00e3o deve normalizar respostas para os tipos compartilhados
 * em `payment-gateway.types.ts`. Erros do gateway devem ser propagados como
 * `PaymentGatewayError` (subclasse de Error com `code`, `httpStatus` e `raw`).
 */
export interface PaymentGateway {
  readonly providerId: GatewayProviderId;

  // ───── Customers ─────
  createCustomer(input: CreateCustomerInput): Promise<GatewayCustomer>;
  getCustomer(customerId: string): Promise<GatewayCustomer | null>;

  // ───── Payment methods (cart\u00e3o) ─────
  tokenizeCard(input: TokenizeCardInput): Promise<GatewayPaymentMethod>;

  // ───── Subscriptions ─────
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<GatewaySubscription>;
  updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<GatewaySubscription>;
  cancelSubscription(
    subscriptionId: string,
    input: CancelSubscriptionInput,
  ): Promise<void>;
  getSubscription(subscriptionId: string): Promise<GatewaySubscription | null>;

  // ───── Invoices / cobran\u00e7as ─────
  getInvoice(invoiceId: string): Promise<GatewayInvoice | null>;
  /** Lista as faturas geradas para uma assinatura, mais recentes primeiro. */
  listInvoicesBySubscription(subscriptionId: string): Promise<GatewayInvoice[]>;

  // ───── Webhooks ─────
  /**
   * Verifica autenticidade do webhook (assinatura/token). Lan\u00e7a se inv\u00e1lido.
   */
  verifyWebhook(input: VerifyWebhookInput): void;
  /**
   * Normaliza o payload bruto do gateway para o shape interno.
   * Eventos n\u00e3o reconhecidos devolvem `type: 'unknown'`.
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
