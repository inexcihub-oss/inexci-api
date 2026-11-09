import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import type { GatewayDiscount } from 'src/shared/payment-gateway/payment-gateway.types';
import {
  ceilDaysSince,
  ceilDaysUntil,
  suspensionDateFor,
} from 'src/modules/billing/billing-days';

export enum AdminAccountSituation {
  TRIAL = 'trial',
  TRIAL_EXPIRED = 'trial_expired',
  ACTIVE = 'active',
  CANCEL_SCHEDULED = 'cancel_scheduled',
  PAST_DUE = 'past_due',
  SUSPENDED = 'suspended',
  CANCELED = 'canceled',
  INTERNAL = 'internal',
  DEACTIVATED = 'deactivated',
}

export const ADMIN_TIME_ZONE = 'America/Sao_Paulo';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AdminAccountSituationInput {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface AdminAccountSituationResult {
  situation: AdminAccountSituation;
  daysLeft: number | null;
  daysOverdue: number | null;
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ADMIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function computeAccountSituation(
  sub: AdminAccountSituationInput,
  now: Date = new Date(),
): AdminAccountSituationResult {
  switch (sub.status) {
    case SubscriptionStatus.TRIALING: {
      if (!sub.trialEndsAt) {
        return {
          situation: AdminAccountSituation.TRIAL,
          daysLeft: null,
          daysOverdue: null,
        };
      }
      if (sub.trialEndsAt.getTime() > now.getTime()) {
        return {
          situation: AdminAccountSituation.TRIAL,
          daysLeft: ceilDaysUntil(sub.trialEndsAt, now),
          daysOverdue: null,
        };
      }
      return {
        situation: AdminAccountSituation.TRIAL_EXPIRED,
        daysLeft: null,
        daysOverdue: ceilDaysSince(sub.trialEndsAt, now),
      };
    }
    case SubscriptionStatus.ACTIVE:
      if (isActiveInTrial(sub, now)) {
        return {
          situation: AdminAccountSituation.TRIAL,
          daysLeft: ceilDaysUntil(sub.trialEndsAt!, now),
          daysOverdue: null,
        };
      }
      return {
        situation: sub.cancelAtPeriodEnd
          ? AdminAccountSituation.CANCEL_SCHEDULED
          : AdminAccountSituation.ACTIVE,
        daysLeft: null,
        daysOverdue: null,
      };
    case SubscriptionStatus.PAST_DUE: {
      if (!sub.pastDueSince) {
        return {
          situation: AdminAccountSituation.PAST_DUE,
          daysLeft: null,
          daysOverdue: null,
        };
      }
      const suspendsAt = suspensionDateFor(sub.pastDueSince);
      return {
        situation: AdminAccountSituation.PAST_DUE,
        daysLeft: ceilDaysUntil(suspendsAt, now),
        daysOverdue: ceilDaysSince(sub.pastDueSince, now),
      };
    }
    case SubscriptionStatus.SUSPENDED:
      return {
        situation: AdminAccountSituation.SUSPENDED,
        daysLeft: null,
        daysOverdue: null,
      };
    case SubscriptionStatus.CANCELED:
      return {
        situation: AdminAccountSituation.CANCELED,
        daysLeft: null,
        daysOverdue: null,
      };
    case SubscriptionStatus.INTERNAL:
      return {
        situation: AdminAccountSituation.INTERNAL,
        daysLeft: null,
        daysOverdue: null,
      };
  }
}

export function isActiveInTrial(
  sub: Pick<Subscription, 'status' | 'trialEndsAt'>,
  now: Date,
): boolean {
  return (
    sub.status === SubscriptionStatus.ACTIVE &&
    !!sub.trialEndsAt &&
    sub.trialEndsAt.getTime() > now.getTime()
  );
}

export type SubscriptionDiscountFields = Partial<
  Pick<
    Subscription,
    | 'discountPercentOff'
    | 'discountAmountOffCents'
    | 'discountDuration'
    | 'discountEndsAt'
  >
>;

export function subscriptionDiscount(
  sub: SubscriptionDiscountFields,
): GatewayDiscount | null {
  if (!sub.discountDuration) return null;
  return {
    name: null,
    percentOff: sub.discountPercentOff ?? null,
    amountOffCents: sub.discountAmountOffCents ?? null,
    duration: sub.discountDuration,
    endsAt: sub.discountEndsAt ?? null,
  };
}

export function computeMonthlyAmountCents(
  sub: Pick<Subscription, 'status'> &
    Partial<Pick<Subscription, 'trialEndsAt'>> &
    SubscriptionDiscountFields,
  plan: { priceCents: number; billingPeriod: string },
  now: Date = new Date(),
): number {
  if (
    sub.status !== SubscriptionStatus.ACTIVE &&
    sub.status !== SubscriptionStatus.PAST_DUE
  ) {
    return 0;
  }
  if (
    isActiveInTrial(
      { status: sub.status, trialEndsAt: sub.trialEndsAt ?? null },
      now,
    )
  ) {
    return 0;
  }
  const chargeCents =
    plan.priceCents -
    discountCentsAt(plan.priceCents, subscriptionDiscount(sub), now);
  return plan.billingPeriod === 'YEARLY'
    ? Math.floor(chargeCents / 12)
    : chargeCents;
}

export function discountCentsAt(
  priceCents: number,
  discount: GatewayDiscount | null | undefined,
  at: Date,
  options: { includeOnce?: boolean } = {},
): number {
  if (!discount || priceCents <= 0) return 0;
  switch (discount.duration) {
    case 'forever':
      break;
    case 'repeating':
      if (discount.endsAt && discount.endsAt.getTime() <= at.getTime()) {
        return 0;
      }
      break;
    case 'once':
      if (!options.includeOnce) return 0;
      break;
    default:
      return 0;
  }
  const raw =
    discount.percentOff !== null && discount.percentOff !== undefined
      ? Math.round((priceCents * discount.percentOff) / 100)
      : (discount.amountOffCents ?? 0);
  return Math.min(priceCents, Math.max(0, raw));
}

export function saoPauloMonthRange(now: Date): { from: Date; to: Date } {
  const [year, month] = dayFormatter.format(now).split('-').map(Number);
  const SP_OFFSET_HOURS = 3;
  return {
    from: new Date(Date.UTC(year, month - 1, 1, SP_OFFSET_HOURS)),
    to: new Date(Date.UTC(year, month, 1, SP_OFFSET_HOURS)),
  };
}

export function saoPauloMonthRangeOf(monthKey: string): {
  from: Date;
  to: Date;
} {
  const [year, month] = monthKey.split('-').map(Number);
  const SP_OFFSET_HOURS = 3;
  return {
    from: new Date(Date.UTC(year, month - 1, 1, SP_OFFSET_HOURS)),
    to: new Date(Date.UTC(year, month, 1, SP_OFFSET_HOURS)),
  };
}

export function saoPauloMonthKey(date: Date): string {
  return dayFormatter.format(date).slice(0, 7);
}

export function saoPauloWeekStart(now: Date): Date {
  const [year, month, day] = dayFormatter.format(now).split('-').map(Number);
  const localMidnight = new Date(Date.UTC(year, month - 1, day, 3));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return new Date(localMidnight.getTime() - sinceMonday * MS_PER_DAY);
}

export function formatSaoPauloDate(date: Date): string {
  return dayFormatter.format(date);
}
