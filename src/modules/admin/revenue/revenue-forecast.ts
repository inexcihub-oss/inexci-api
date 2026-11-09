import type {
  GatewayBillingCycle,
  GatewayDiscount,
} from 'src/shared/payment-gateway/payment-gateway.types';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import {
  discountCentsAt,
  isActiveInTrial,
  saoPauloMonthKey,
  subscriptionDiscount,
  saoPauloMonthRange,
  saoPauloMonthRangeOf,
} from '../accounts/admin-account-situation';

export type ForecastKind = 'guaranteed' | 'trial_conversion';
export type ForecastSource = 'preview' | 'projection';

export interface ForecastSubscription {
  ownerId: string;
  name: string;
  email: string;
  kind: ForecastKind;
  firstChargeAt: Date;
  cycle: GatewayBillingCycle;
  priceCents: number;
  discount: GatewayDiscount | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  previewAmountCents: number | null;
}

export interface ForecastCharge {
  ownerId: string;
  name: string;
  email: string;
  kind: ForecastKind;
  chargeAt: Date;
  amountCents: number;
  source: ForecastSource;
}

export interface ForecastMonth {
  month: string;
  guaranteedCents: number;
  trialConversionCents: number;
  items: ForecastCharge[];
}

const MAX_CHARGES = 240;

export function addMonthsClamped(base: Date, months: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(base.getUTCDate(), lastDay),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

export function projectCharges(
  sub: ForecastSubscription,
  window: { from: Date; to: Date },
): ForecastCharge[] {
  if (sub.cancelAtPeriodEnd) return [];
  const step = sub.cycle === 'YEARLY' ? 12 : 1;
  const charges: ForecastCharge[] = [];

  for (let k = 0; k < MAX_CHARGES; k++) {
    const chargeAt = addMonthsClamped(sub.firstChargeAt, k * step);
    if (chargeAt.getTime() >= window.to.getTime()) break;
    if (sub.cancelAt && chargeAt.getTime() >= sub.cancelAt.getTime()) break;
    if (chargeAt.getTime() < window.from.getTime()) continue;

    const isFirst = charges.length === 0;
    const usePreview = isFirst && sub.previewAmountCents !== null;
    const amountCents = usePreview
      ? (sub.previewAmountCents as number)
      : sub.priceCents -
        discountCentsAt(sub.priceCents, sub.discount, chargeAt, {
          includeOnce: isFirst,
        });

    charges.push({
      ownerId: sub.ownerId,
      name: sub.name,
      email: sub.email,
      kind: sub.kind,
      chargeAt,
      amountCents,
      source: usePreview ? 'preview' : 'projection',
    });
  }
  return charges;
}

export function forecastWindow(
  now: Date,
  months: number,
): { from: Date; to: Date; monthKeys: string[] } {
  const monthKeys: string[] = [];
  let cursor = saoPauloMonthRange(now).from;
  for (let i = 0; i < months; i++) {
    const key = saoPauloMonthKey(cursor);
    monthKeys.push(key);
    cursor = saoPauloMonthRangeOf(key).to;
  }
  return { from: now, to: cursor, monthKeys };
}

export function buildForecastMonths(
  subs: ForecastSubscription[],
  now: Date,
  months: number,
): ForecastMonth[] {
  const window = forecastWindow(now, months);
  const byMonth = new Map<string, ForecastMonth>(
    window.monthKeys.map((month) => [
      month,
      { month, guaranteedCents: 0, trialConversionCents: 0, items: [] },
    ]),
  );

  const charges = subs
    .flatMap((sub) => projectCharges(sub, window))
    .sort((a, b) => a.chargeAt.getTime() - b.chargeAt.getTime());

  for (const charge of charges) {
    const bucket = byMonth.get(saoPauloMonthKey(charge.chargeAt));
    if (!bucket) continue;
    bucket.items.push(charge);
    if (charge.kind === 'trial_conversion') {
      bucket.trialConversionCents += charge.amountCents;
    } else {
      bucket.guaranteedCents += charge.amountCents;
    }
  }
  return window.monthKeys.map((key) => byMonth.get(key)!);
}

export function localForecastInput(
  sub: Subscription,
  now: Date,
): ForecastSubscription | null {
  if (!sub.gatewaySubscriptionId) return null;
  if (sub.status !== SubscriptionStatus.ACTIVE) return null;
  if (sub.cancelAtPeriodEnd) return null;
  const isTrial = isActiveInTrial(sub, now);
  const firstChargeAt = isTrial ? sub.trialEndsAt : sub.currentPeriodEnd;
  if (!firstChargeAt) return null;
  return {
    ownerId: sub.ownerId,
    name: sub.owner?.name ?? '',
    email: sub.owner?.email ?? '',
    kind: isTrial ? 'trial_conversion' : 'guaranteed',
    firstChargeAt,
    cycle: sub.plan.billingPeriod,
    priceCents: sub.plan.priceCents,
    discount: subscriptionDiscount(sub),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    previewAmountCents: null,
  };
}

export interface NextMonthForecast {
  month: string;
  guaranteedCents: number;
  trialConversionCents: number;
  totalCents: number;
}

export function nextMonthForecast(
  subs: Subscription[],
  now: Date,
): NextMonthForecast {
  const inputs = subs
    .map((sub) => localForecastInput(sub, now))
    .filter((i): i is ForecastSubscription => i !== null);
  const next = buildForecastMonths(inputs, now, 2)[1];
  return {
    month: next.month,
    guaranteedCents: next.guaranteedCents,
    trialConversionCents: next.trialConversionCents,
    totalCents: next.guaranteedCents + next.trialConversionCents,
  };
}
