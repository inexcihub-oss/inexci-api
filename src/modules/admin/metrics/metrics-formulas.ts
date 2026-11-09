import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { computeMonthlyAmountCents } from '../accounts/admin-account-situation';
import { addMonthsClamped } from '../revenue/revenue-forecast';

export const METRICS_PERIODS = ['30d', '90d', '12m'] as const;
export type MetricsPeriod = (typeof METRICS_PERIODS)[number];

export const SNAPSHOT_TOLERANCE_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SP_OFFSET_HOURS = 3;

export interface SnapshotPoint {
  day: string;
  mrrCents: number;
  payingAccounts: number;
}

export function periodStart(period: MetricsPeriod, now: Date): Date {
  switch (period) {
    case '30d':
      return new Date(now.getTime() - 30 * MS_PER_DAY);
    case '90d':
      return new Date(now.getTime() - 90 * MS_PER_DAY);
    case '12m':
      return addMonthsClamped(now, -12);
  }
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function ratePercent(
  numerator: number,
  denominator: number | null,
): number | null {
  if (denominator === null || denominator <= 0) return null;
  return roundOneDecimal((numerator / denominator) * 100);
}

export function changePercent(
  current: number,
  previous: number | null,
): number | null {
  if (previous === null || previous <= 0) return null;
  return roundOneDecimal(((current - previous) / previous) * 100);
}

export function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function saoPauloDayRangeOf(dayKey: string): { from: Date; to: Date } {
  const [year, month, day] = dayKey.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, day, SP_OFFSET_HOURS)),
    to: new Date(Date.UTC(year, month - 1, day + 1, SP_OFFSET_HOURS)),
  };
}

export function monthKeysEndingAt(monthKey: string, count: number): string[] {
  const [year, month] = monthKey.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

export function snapshotOnOrBefore<T extends { day: string }>(
  snapshots: T[],
  dayKey: string,
  toleranceDays: number = SNAPSHOT_TOLERANCE_DAYS,
): T | null {
  const minDay = shiftDayKey(dayKey, -toleranceDays);
  let found: T | null = null;
  for (const snap of snapshots) {
    if (snap.day > dayKey || snap.day < minDay) continue;
    if (!found || snap.day > found.day) found = snap;
  }
  return found;
}

export function mrrMonthlySeries(
  monthKeys: string[],
  snapshots: SnapshotPoint[],
  currentMonthKey: string,
  liveMrrCents: number,
): Array<{ month: string; mrrCents: number | null }> {
  const lastByMonth = new Map<string, SnapshotPoint>();
  for (const snap of snapshots) {
    const month = snap.day.slice(0, 7);
    const current = lastByMonth.get(month);
    if (!current || snap.day > current.day) lastByMonth.set(month, snap);
  }
  return monthKeys.map((month) => ({
    month,
    mrrCents:
      month === currentMonthKey
        ? liveMrrCents
        : (lastByMonth.get(month)?.mrrCents ?? null),
  }));
}

export function lostMrrCents(canceled: Subscription[]): number {
  return canceled.reduce(
    (sum, sub) =>
      sum +
      computeMonthlyAmountCents(
        { ...sub, status: SubscriptionStatus.ACTIVE, trialEndsAt: null },
        sub.plan,
        sub.canceledAt ?? new Date(),
      ),
    0,
  );
}
