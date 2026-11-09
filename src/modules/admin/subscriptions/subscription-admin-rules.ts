import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { PaymentGateway } from 'src/shared/payment-gateway/payment-gateway.interface';
import { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';

export const LIVE_PROVIDER_STATUSES: readonly string[] = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
];

export const MENSAGEM_ASSINATURA_VIVA =
  'Conta com assinatura na Stripe não pode receber acesso interno.';
export const MENSAGEM_STRIPE_INDISPONIVEL =
  'Não foi possível consultar a Stripe. Nada foi alterado; tente novamente em instantes.';

export type BlockKind = 'conflict' | 'gateway_unavailable';

export interface ActionBlock {
  kind: BlockKind;
  message: string;
}

export class GatewayLookupError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'GatewayLookupError';
  }
}

export function isLiveGatewaySubscription(sub: GatewaySubscription): boolean {
  if (sub.providerStatus) {
    return LIVE_PROVIDER_STATUSES.includes(sub.providerStatus);
  }
  return sub.status !== 'canceled' && sub.status !== 'expired';
}

export function isTrialingGatewaySubscription(
  sub: GatewaySubscription,
): boolean {
  return sub.providerStatus === 'trialing';
}

export function uniqueGatewaySubscriptions(
  list: Array<GatewaySubscription | null | undefined>,
): GatewaySubscription[] {
  const seen = new Map<string, GatewaySubscription>();
  for (const item of list) {
    if (item && !seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

export async function lookupGatewaySubscriptions(
  gateway: PaymentGateway,
  sub: Pick<
    Subscription,
    'gatewayProvider' | 'gatewayCustomerId' | 'gatewaySubscriptionId'
  >,
): Promise<GatewaySubscription[]> {
  if (!sub.gatewayCustomerId && !sub.gatewaySubscriptionId) return [];
  if (sub.gatewayProvider !== gateway.providerId) {
    throw new GatewayLookupError(
      `gateway ${sub.gatewayProvider} não suportado`,
    );
  }
  try {
    const [byId, latest] = await Promise.all([
      sub.gatewaySubscriptionId
        ? gateway.getSubscription(sub.gatewaySubscriptionId)
        : Promise.resolve(null),
      sub.gatewayCustomerId
        ? gateway.getLatestSubscriptionByCustomer(sub.gatewayCustomerId)
        : Promise.resolve(null),
    ]);
    return uniqueGatewaySubscriptions([byId, latest]);
  } catch (err) {
    throw new GatewayLookupError(err);
  }
}

export function internalAccessBlock(
  status: SubscriptionStatus,
  remote: GatewaySubscription[] | null,
): ActionBlock | null {
  if (status === SubscriptionStatus.INTERNAL) {
    return { kind: 'conflict', message: 'A conta já tem acesso interno.' };
  }
  if (remote === null) {
    return {
      kind: 'gateway_unavailable',
      message: MENSAGEM_STRIPE_INDISPONIVEL,
    };
  }
  if (remote.some(isLiveGatewaySubscription)) {
    return { kind: 'conflict', message: MENSAGEM_ASSINATURA_VIVA };
  }
  return null;
}

export const MENSAGEM_DESATIVAR_COM_ASSINATURA =
  'A conta tem assinatura com cobrança na Stripe. Peça ao cliente para cancelar pelo portal de pagamento antes de desativar.';

export function deactivationBlock(
  status: SubscriptionStatus,
  remote: GatewaySubscription[] | null,
): ActionBlock | null {
  if (status === SubscriptionStatus.INTERNAL) return null;
  if (remote === null) {
    return {
      kind: 'gateway_unavailable',
      message: MENSAGEM_STRIPE_INDISPONIVEL,
    };
  }
  if (remote.some(isLiveGatewaySubscription)) {
    return { kind: 'conflict', message: MENSAGEM_DESATIVAR_COM_ASSINATURA };
  }
  return null;
}

export type TrialExtensionDecision =
  | { block: ActionBlock; gatewayTrial: null }
  | { block: null; gatewayTrial: GatewaySubscription | null };

export function trialExtensionDecision(
  sub: Pick<Subscription, 'status' | 'gatewaySubscriptionId'>,
  remote: GatewaySubscription[] | null,
): TrialExtensionDecision {
  if (remote === null) {
    return {
      block: {
        kind: 'gateway_unavailable',
        message: MENSAGEM_STRIPE_INDISPONIVEL,
      },
      gatewayTrial: null,
    };
  }
  const live = remote.filter(isLiveGatewaySubscription);
  const trialing = live.filter(isTrialingGatewaySubscription);
  if (trialing.length > 0) {
    if (
      sub.status !== SubscriptionStatus.TRIALING &&
      sub.status !== SubscriptionStatus.ACTIVE
    ) {
      return {
        block: {
          kind: 'conflict',
          message: 'A situação da conta não permite estender o trial.',
        },
        gatewayTrial: null,
      };
    }
    const preferred =
      trialing.find((t) => t.id === sub.gatewaySubscriptionId) ?? trialing[0];
    return { block: null, gatewayTrial: preferred };
  }
  if (live.length > 0) {
    return {
      block: {
        kind: 'conflict',
        message:
          'A assinatura na Stripe não está em trial; o prazo é definido pela cobrança.',
      },
      gatewayTrial: null,
    };
  }
  if (sub.status !== SubscriptionStatus.TRIALING) {
    return {
      block: {
        kind: 'conflict',
        message:
          'Só é possível estender o trial de uma conta em trial ou com trial vencido.',
      },
      gatewayTrial: null,
    };
  }
  return { block: null, gatewayTrial: null };
}
