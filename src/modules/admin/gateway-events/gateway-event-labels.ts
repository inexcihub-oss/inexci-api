import type { NormalizedWebhookEventType } from 'src/shared/payment-gateway/payment-gateway.types';

const LABELS: Record<NormalizedWebhookEventType, string> = {
  'checkout.completed': 'Checkout concluído',
  'subscription.created': 'Assinatura criada',
  'subscription.updated': 'Assinatura atualizada',
  'subscription.canceled': 'Assinatura cancelada',
  'invoice.paid': 'Fatura paga',
  'invoice.failed': 'Pagamento da fatura falhou',
  'invoice.overdue': 'Fatura vencida',
  'invoice.finalized': 'Fatura emitida',
  'invoice.voided': 'Fatura anulada',
  unknown: 'Evento não reconhecido',
};

const NEEDS_SUBSCRIPTION: ReadonlySet<string> = new Set([
  'checkout.completed',
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'invoice.paid',
  'invoice.failed',
  'invoice.overdue',
]);

export const SUBSCRIPTION_NOT_IDENTIFIED =
  'A plataforma não identificou a assinatura neste evento, então o status da assinatura não foi atualizado por ele.';

export function gatewayEventLabel(eventType: string): string {
  return LABELS[eventType as NormalizedWebhookEventType] ?? eventType;
}

export function needsSubscription(eventType: string): boolean {
  return NEEDS_SUBSCRIPTION.has(eventType);
}
