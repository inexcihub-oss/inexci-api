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
  GatewayInvoice,
  GatewayInvoicePage,
  GatewayInvoicePreview,
  GatewayPaymentSummary,
  GatewayPrice,
  GatewayProviderId,
  GatewaySubscription,
  ListGatewayInvoicesParams,
  NormalizedWebhookEvent,
  VerifyWebhookInput,
} from './payment-gateway.types';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface PaymentGateway {
  readonly providerId: GatewayProviderId;

  createCustomer(input: CreateCustomerInput): Promise<GatewayCustomer>;
  getCustomer(customerId: string): Promise<GatewayCustomer | null>;
  getCustomerPaymentSummary(customerId: string): Promise<GatewayPaymentSummary>;

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<GatewayCheckoutSession>;
  createBillingPortalSession(
    input: CreateBillingPortalSessionInput,
  ): Promise<GatewayBillingPortalSession>;

  getSubscription(subscriptionId: string): Promise<GatewaySubscription | null>;
  getSubscriptionWithDiscount(
    subscriptionId: string,
  ): Promise<GatewaySubscription | null>;
  getLatestSubscriptionByCustomer(
    customerId: string,
  ): Promise<GatewaySubscription | null>;
  updateTrialEnd(
    subscriptionId: string,
    trialEnd: Date,
    idempotencyKey: string,
  ): Promise<GatewaySubscription>;

  listInvoices(params: ListGatewayInvoicesParams): Promise<GatewayInvoicePage>;
  getInvoice(invoiceId: string): Promise<GatewayInvoice | null>;
  previewNextInvoice(
    subscriptionId: string,
  ): Promise<GatewayInvoicePreview | null>;
  getPrice(priceId: string): Promise<GatewayPrice | null>;

  createCoupon(
    input: CreateCouponInput,
    idempotencyKey: string,
  ): Promise<GatewayCoupon>;
  listCoupons(maxItems?: number): Promise<GatewayCouponPage>;
  getCoupon(promotionCodeId: string): Promise<GatewayCoupon | null>;
  deactivateCoupon(
    promotionCodeId: string,
    idempotencyKey: string,
  ): Promise<void>;

  verifyWebhook(input: VerifyWebhookInput): void;
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
