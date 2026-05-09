/**
 * Tipos brutos da API Asaas v3, conforme documenta\u00e7\u00e3o oficial.
 * S\u00e3o usados internamente pelo `AsaasProvider` para tipagem est\u00e1tica
 * antes da normaliza\u00e7\u00e3o para os shapes de `payment-gateway.types.ts`.
 */

export interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj?: string;
  phone?: string;
  mobilePhone?: string;
  externalReference?: string;
}

export type AsaasBillingType = 'CREDIT_CARD' | 'BOLETO' | 'PIX' | 'UNDEFINED';

export type AsaasSubscriptionCycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'BIMONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUALLY'
  | 'YEARLY';

export type AsaasSubscriptionStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';

export interface AsaasSubscription {
  id: string;
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string; // YYYY-MM-DD
  cycle: AsaasSubscriptionCycle;
  description?: string;
  status: AsaasSubscriptionStatus;
  externalReference?: string;
  creditCardToken?: string;
  deleted?: boolean;
}

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED';

export interface AsaasPayment {
  id: string;
  customer: string;
  subscription?: string;
  status: AsaasPaymentStatus;
  billingType: AsaasBillingType;
  value: number;
  netValue?: number;
  dueDate: string; // YYYY-MM-DD
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  transactionReceiptUrl?: string;
  externalReference?: string;
  deleted?: boolean;
}

export interface AsaasCreditCardTokenizeResponse {
  creditCardNumber: string; // mascarado
  creditCardBrand: string;
  creditCardToken: string;
}

export interface AsaasErrorResponse {
  errors: Array<{ code: string; description: string }>;
}

/** Tipos de evento do webhook Asaas. */
export type AsaasWebhookEventType =
  | 'PAYMENT_CREATED'
  | 'PAYMENT_AWAITING_RISK_ANALYSIS'
  | 'PAYMENT_APPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_RECEIVED_IN_CASH_UNDONE'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_DELETED'
  | 'PAYMENT_RESTORED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_REFUND_IN_PROGRESS'
  | 'PAYMENT_RECEIVED_IN_CASH'
  | 'PAYMENT_CHARGEBACK_REQUESTED'
  | 'PAYMENT_CHARGEBACK_DISPUTE'
  | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
  | 'PAYMENT_DUNNING_RECEIVED'
  | 'PAYMENT_DUNNING_REQUESTED'
  | 'PAYMENT_BANK_SLIP_VIEWED'
  | 'PAYMENT_CHECKOUT_VIEWED'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_UPDATED'
  | 'SUBSCRIPTION_DELETED';

export interface AsaasWebhookEvent {
  /** A Asaas n\u00e3o envia um id de evento; usamos `payment.id` ou `subscription.id` + tipo. */
  id?: string;
  event: AsaasWebhookEventType;
  dateCreated?: string;
  payment?: AsaasPayment;
  subscription?: AsaasSubscription;
}
