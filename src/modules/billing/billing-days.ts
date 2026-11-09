export const PAST_DUE_GRACE_DAYS = 7;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ceilDaysUntil(target: Date, now: Date): number {
  return Math.max(
    0,
    Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY),
  );
}

export function ceilDaysSince(from: Date, now: Date): number {
  return Math.max(1, Math.ceil((now.getTime() - from.getTime()) / MS_PER_DAY));
}

export function suspensionDateFor(pastDueSince: Date): Date {
  const d = new Date(pastDueSince);
  d.setUTCDate(d.getUTCDate() + PAST_DUE_GRACE_DAYS);
  return d;
}
