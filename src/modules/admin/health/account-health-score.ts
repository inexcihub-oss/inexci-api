import {
  AccountHealthBand,
  AccountHealthFactor,
} from 'src/database/entities/account-health-daily.entity';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { AccountHealthInput } from 'src/database/repositories/account-health.repository';
import {
  AccountHealthConfig,
  AccountHealthStep,
  ACCOUNT_HEALTH_CONFIG,
} from './account-health.config';

export interface AccountHealthResult {
  score: number;
  band: AccountHealthBand;
  factors: AccountHealthFactor[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UNLIMITED_QUOTA = -1;

function pointsFor(value: number, steps: AccountHealthStep[]): number {
  const step = steps.find((s) => value >= s.threshold);
  return step?.points ?? 0;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function daysUntil(target: Date, now: Date): number {
  return Math.max(
    0,
    Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY),
  );
}

export function bandOf(
  score: number,
  config: AccountHealthConfig = ACCOUNT_HEALTH_CONFIG,
): AccountHealthBand {
  if (score >= config.bands.healthy) return 'healthy';
  if (score >= config.bands.attention) return 'attention';
  return 'risk';
}

export function isScoredAccount(input: AccountHealthInput): boolean {
  return !input.deactivated && input.status !== SubscriptionStatus.CANCELED;
}

function lastSeenFactor(
  input: AccountHealthInput,
  now: Date,
  isNew: boolean,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  if (isNew) return null;
  if (!input.lastSeenAt) {
    const sinceSignup = daysBetween(input.ownerCreatedAt, now);
    const points = pointsFor(
      Math.max(sinceSignup, config.lastSeen.neverSeenDays),
      config.lastSeen.steps,
    );
    return {
      key: 'last_seen',
      points,
      message: `Ninguém da clínica acessou desde o cadastro, há ${plural(sinceSignup, 'dia', 'dias')}`,
    };
  }
  const days = daysBetween(input.lastSeenAt, now);
  const points = pointsFor(days, config.lastSeen.steps);
  if (points === 0) return null;
  return {
    key: 'last_seen',
    points,
    message: `Ninguém da clínica acessa há ${plural(days, 'dia', 'dias')}`,
  };
}

function usageDropFactor(
  input: AccountHealthInput,
  isNew: boolean,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  if (isNew) return null;
  if (input.usagePrevious < config.usageDrop.minPreviousWeek) return null;
  if (input.usageCurrent >= input.usagePrevious) return null;
  const drop = Math.round(
    ((input.usagePrevious - input.usageCurrent) / input.usagePrevious) * 100,
  );
  const points = pointsFor(drop, config.usageDrop.steps);
  if (points === 0) return null;
  return {
    key: 'usage_drop',
    points,
    message: `Uso caiu ${drop}% em relação à semana anterior (${input.usagePrevious} → ${input.usageCurrent} SCs e consultas)`,
  };
}

function trialFactor(
  input: AccountHealthInput,
  now: Date,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  if (input.hasGatewaySubscription || !input.trialEndsAt) return null;
  const inTrialStatus =
    input.status === SubscriptionStatus.TRIALING ||
    input.status === SubscriptionStatus.ACTIVE;
  if (!inTrialStatus) return null;
  const ends = input.trialEndsAt.getTime();
  if (ends <= now.getTime()) {
    if (input.status !== SubscriptionStatus.TRIALING) return null;
    const days = daysBetween(input.trialEndsAt, now);
    return {
      key: 'trial_ending',
      points: config.trial.expiredPoints,
      message:
        days === 0
          ? 'Trial venceu hoje sem assinatura'
          : `Trial venceu há ${plural(days, 'dia', 'dias')} sem assinatura`,
    };
  }
  const left = daysUntil(input.trialEndsAt, now);
  if (left > config.trial.endingWithinDays) return null;
  return {
    key: 'trial_ending',
    points: config.trial.endingPoints,
    message:
      left === 0
        ? 'Trial termina hoje e não há cartão cadastrado'
        : `Trial termina em ${plural(left, 'dia', 'dias')} e não há cartão cadastrado`,
  };
}

function quotaFactor(
  input: AccountHealthInput,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  if (input.quotaUsed === null || input.quotaLimit === null) return null;
  if (input.quotaLimit === UNLIMITED_QUOTA || input.quotaLimit <= 0)
    return null;
  const percent = Math.round((input.quotaUsed / input.quotaLimit) * 100);
  if (percent >= 100) {
    return {
      key: 'quota',
      points: config.quota.exhaustedPoints,
      message: `Cota de SCs esgotada (${input.quotaUsed} de ${input.quotaLimit})`,
    };
  }
  if (percent < config.quota.thresholdPercent) return null;
  return {
    key: 'quota',
    points: config.quota.points,
    message: `Usou ${percent}% da cota de SCs do período (${input.quotaUsed} de ${input.quotaLimit})`,
  };
}

function errorsFactor(
  input: AccountHealthInput,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  const points = pointsFor(input.errors, config.errors.steps);
  if (points === 0) return null;
  return {
    key: 'errors',
    points,
    message: `${plural(input.errors, 'erro', 'erros')} da plataforma nos últimos ${config.errors.windowDays} dias`,
  };
}

function deliveryFactor(
  input: AccountHealthInput,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  const points = pointsFor(
    input.deliveryFailures,
    config.deliveryFailures.steps,
  );
  if (points === 0) return null;
  const hours = config.deliveryFailures.windowHours;
  return {
    key: 'delivery_failures',
    points,
    message: `${plural(input.deliveryFailures, 'envio de e-mail ou WhatsApp falhou', 'envios de e-mail ou WhatsApp falharam')} nas últimas ${hours} h`,
  };
}

function delinquencyFactor(
  input: AccountHealthInput,
  now: Date,
  config: AccountHealthConfig,
): AccountHealthFactor | null {
  if (input.status === SubscriptionStatus.SUSPENDED) {
    return {
      key: 'delinquency',
      points: config.delinquency.suspendedPoints,
      message: 'Conta suspensa por falta de pagamento',
    };
  }
  if (input.status !== SubscriptionStatus.PAST_DUE) return null;
  const days = input.pastDueSince ? daysBetween(input.pastDueSince, now) : null;
  return {
    key: 'delinquency',
    points: config.delinquency.pastDuePoints,
    message:
      days === null
        ? 'Pagamento em atraso'
        : `Pagamento em atraso há ${plural(days, 'dia', 'dias')}`,
  };
}

export function scoreAccount(
  input: AccountHealthInput,
  now: Date,
  config: AccountHealthConfig = ACCOUNT_HEALTH_CONFIG,
): AccountHealthResult | null {
  if (!isScoredAccount(input)) return null;
  const isNew =
    daysBetween(input.ownerCreatedAt, now) < config.newAccountGraceDays;
  const internal = input.status === SubscriptionStatus.INTERNAL;

  const factors = [
    lastSeenFactor(input, now, isNew, config),
    usageDropFactor(input, isNew, config),
    internal ? null : trialFactor(input, now, config),
    quotaFactor(input, config),
    errorsFactor(input, config),
    deliveryFactor(input, config),
    internal ? null : delinquencyFactor(input, now, config),
  ]
    .filter((f): f is AccountHealthFactor => f !== null && f.points > 0)
    .sort((a, b) => b.points - a.points);

  const lost = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, 100 - lost));
  return { score, band: bandOf(score, config), factors };
}
