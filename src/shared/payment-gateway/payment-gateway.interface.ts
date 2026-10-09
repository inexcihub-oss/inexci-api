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

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface PaymentGateway {
  readonly providerId: GatewayProviderId;

  createCustomer(input: CreateCustomerInput): Promise<GatewayCustomer>;
  getCustomer(customerId: string): Promise<GatewayCustomer | null>;

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<GatewayCheckoutSession>;
  createBillingPortalSession(
    input: CreateBillingPortalSessionInput,
  ): Promise<GatewayBillingPortalSession>;

  getSubscription(subscriptionId: string): Promise<GatewaySubscription | null>;
  getLatestSubscriptionByCustomer(
    customerId: string,
  ): Promise<GatewaySubscription | null>;

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
