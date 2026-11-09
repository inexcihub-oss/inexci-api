import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AdminRevenueRepository,
  AdminInvoicesFilter,
} from 'src/database/repositories/admin-revenue.repository';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import type { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import type {
  GatewayPrice,
  GatewaySubscription,
} from 'src/shared/payment-gateway/payment-gateway.types';
import {
  ceilDaysSince,
  suspensionDateFor,
} from 'src/modules/billing/billing-days';
import {
  computeMonthlyAmountCents,
  isActiveInTrial,
  saoPauloMonthKey,
  saoPauloMonthRange,
  saoPauloMonthRangeOf,
  subscriptionDiscount,
} from '../accounts/admin-account-situation';
import {
  ForecastSubscription,
  buildForecastMonths,
  forecastWindow,
} from './revenue-forecast';
import { SimpleCache } from 'src/shared/ai/utils/simple-cache';
import type {
  AdminDelinquencyResponseDto,
  AdminForecastResponseDto,
  AdminInvoiceListResponseDto,
  AdminPlanDto,
  AdminRevenueSummaryDto,
} from './dto/admin-revenue-response.dto';

export interface AdminMrrResult {
  mrrCents: number;
  payingAccounts: number;
}

const STRIPE_CONCURRENCY = 5;
const SUBSCRIPTION_CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORY_MONTHS = 12;
const MIN_FORECAST_MONTHS = 1;
const MAX_FORECAST_MONTHS = 24;

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

export function summarizeMrr(subs: Subscription[], now: Date): AdminMrrResult {
  const amounts = subs.map((sub) =>
    computeMonthlyAmountCents(sub, sub.plan, now),
  );
  return {
    mrrCents: amounts.reduce((sum, v) => sum + v, 0),
    payingAccounts: amounts.filter((v) => v > 0).length,
  };
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

@Injectable()
export class AdminRevenueService {
  private readonly logger = new Logger(AdminRevenueService.name);
  private readonly subscriptionCache =
    new SimpleCache<GatewaySubscription | null>();

  constructor(
    private readonly repo: AdminRevenueRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async computeMrrCents(now: Date = new Date()): Promise<number> {
    return (await this.computeMrr(now)).mrrCents;
  }

  async computeMrr(now: Date = new Date()): Promise<AdminMrrResult> {
    return summarizeMrr(await this.repo.findRevenueSubscriptions(), now);
  }

  async getSummary(
    month: string | undefined,
    now: Date = new Date(),
  ): Promise<AdminRevenueSummaryDto> {
    const monthKey = month ?? saoPauloMonthKey(now);
    const range = saoPauloMonthRangeOf(monthKey);
    const historyKeys = this.monthKeysEndingAt(monthKey, HISTORY_MONTHS);
    const historyFrom = saoPauloMonthRangeOf(historyKeys[0]).from;

    const [paid, open, delinquent, history, mrr] = await Promise.all([
      this.repo.sumPaidBetween(range.from, range.to),
      this.repo.openTotals(),
      this.loadDelinquent(),
      this.repo.receivedByMonth(historyFrom, range.to),
      this.computeMrr(now),
    ]);

    const byMonth = new Map(history.map((h) => [h.month, h.receivedCents]));
    return {
      month: monthKey,
      receivedCents: paid.receivedCents,
      receivedInvoices: paid.invoices,
      discountsCents: paid.discountCents,
      openCents: open.amountCents,
      openInvoices: open.invoices,
      delinquentCents: delinquent.reduce((s, d) => s + d.open.amountCents, 0),
      delinquentAccounts: delinquent.length,
      mrrCents: mrr.mrrCents,
      arrCents: mrr.mrrCents * 12,
      payingAccounts: mrr.payingAccounts,
      averageTicketCents: mrr.payingAccounts
        ? Math.round(mrr.mrrCents / mrr.payingAccounts)
        : 0,
      receivedByMonth: historyKeys.map((key) => ({
        month: key,
        receivedCents: byMonth.get(key) ?? 0,
      })),
    };
  }

  async getForecast(
    months: number = 6,
    now: Date = new Date(),
  ): Promise<AdminForecastResponseDto> {
    const windowMonths = Math.min(
      MAX_FORECAST_MONTHS,
      Math.max(MIN_FORECAST_MONTHS, Math.floor(months) || MIN_FORECAST_MONTHS),
    );
    const subs = await this.repo.findRevenueSubscriptions();
    const windowEnd = forecastWindow(now, windowMonths).to;
    let partial = false;

    const inputs = await runPool(subs, STRIPE_CONCURRENCY, async (sub) => {
      const result = await this.toForecastInput(sub, now, windowEnd);
      if (result.partial) partial = true;
      return result.input;
    });

    const forecastMonths = buildForecastMonths(
      inputs.filter((i): i is ForecastSubscription => i !== null),
      now,
      windowMonths,
    );
    return {
      generatedAt: now,
      partial,
      totalGuaranteedCents: forecastMonths.reduce(
        (s, m) => s + m.guaranteedCents,
        0,
      ),
      totalTrialConversionCents: forecastMonths.reduce(
        (s, m) => s + m.trialConversionCents,
        0,
      ),
      months: forecastMonths,
    };
  }

  async listInvoices(
    filter: AdminInvoicesFilter,
  ): Promise<AdminInvoiceListResponseDto> {
    const { items, total } = await this.repo.findInvoices(filter);
    return {
      total,
      limit: filter.limit,
      offset: filter.offset,
      items: items.map(({ invoice, ownerName, ownerEmail }) => ({
        id: invoice.id,
        gatewayInvoiceId: invoice.gatewayInvoiceId,
        ownerId: invoice.ownerId,
        ownerName,
        ownerEmail,
        status: invoice.status,
        amountDueCents: invoice.amountDueCents,
        amountPaidCents: invoice.amountPaidCents,
        amountRemainingCents: Math.max(
          0,
          invoice.amountDueCents - invoice.amountPaidCents,
        ),
        amountDiscountCents: invoice.amountDiscountCents,
        currency: invoice.currency,
        couponCode: invoice.couponCode,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        invoiceCreatedAt: invoice.invoiceCreatedAt,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      })),
    };
  }

  async getDelinquency(
    now: Date = new Date(),
  ): Promise<AdminDelinquencyResponseDto> {
    const delinquent = await this.loadDelinquent();
    const items = delinquent.map(({ sub, open }) => ({
      ownerId: sub.ownerId,
      name: sub.owner?.name ?? '',
      email: sub.owner?.email ?? '',
      planName: sub.plan?.name ?? '',
      status: sub.status as 'past_due' | 'suspended',
      openCents: open.amountCents,
      openInvoices: open.invoices,
      pastDueSince: sub.pastDueSince,
      daysOverdue: sub.pastDueSince
        ? ceilDaysSince(sub.pastDueSince, now)
        : null,
      suspensionDate:
        sub.status === SubscriptionStatus.SUSPENDED
          ? sub.suspendedAt
          : sub.pastDueSince
            ? suspensionDateFor(sub.pastDueSince)
            : null,
    }));
    return {
      totalOpenCents: items.reduce((s, i) => s + i.openCents, 0),
      items,
    };
  }

  async listPlans(): Promise<AdminPlanDto[]> {
    const { plans, counts } = await this.repo.findPlansWithAccountCounts();
    return runPool(plans, STRIPE_CONCURRENCY, async (plan) => {
      const base = {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        billingPeriod: plan.billingPeriod,
        priceCents: plan.priceCents,
        currency: plan.currency,
        surgeryRequestQuota: plan.surgeryRequestQuota,
        isActive: plan.isActive,
        isTrialDefault: plan.isTrialDefault,
        gatewayPriceId: plan.gatewayPriceId,
        accounts: counts.get(plan.id) ?? 0,
        gatewayPriceCents: null as number | null,
        gatewayCycle: null as 'MONTHLY' | 'YEARLY' | null,
        gatewayCurrency: null as string | null,
        gatewayPriceActive: null as boolean | null,
      };
      if (!plan.gatewayPriceId) {
        return { ...base, divergent: null, gatewayError: false };
      }
      let price: GatewayPrice | null;
      try {
        price = await this.gateway.getPrice(plan.gatewayPriceId);
      } catch (err) {
        this.logger.warn(
          `[admin-revenue] preço ${plan.gatewayPriceId} indisponível na Stripe: ${errorMessage(err)}`,
        );
        return { ...base, divergent: null, gatewayError: true };
      }
      if (!price) return { ...base, divergent: true, gatewayError: false };
      return {
        ...base,
        gatewayPriceCents: price.unitAmountCents,
        gatewayCycle: price.cycle,
        gatewayCurrency: price.currency,
        gatewayPriceActive: price.active,
        divergent: this.isDivergent(plan, price),
        gatewayError: false,
      };
    });
  }

  private isDivergent(plan: SubscriptionPlan, price: GatewayPrice): boolean {
    return (
      price.unitAmountCents !== plan.priceCents ||
      price.cycle !== plan.billingPeriod ||
      price.currency.toUpperCase() !== (plan.currency ?? '').toUpperCase()
    );
  }

  private async loadDelinquent(): Promise<
    Array<{
      sub: Subscription;
      open: { amountCents: number; invoices: number };
    }>
  > {
    const subs = await this.repo.findDelinquentSubscriptions();
    const open = await this.repo.outstandingByOwner(subs.map((s) => s.ownerId));
    return subs.map((sub) => ({
      sub,
      open: open.get(sub.ownerId) ?? { amountCents: 0, invoices: 0 },
    }));
  }

  private async readRemote(
    sub: Subscription,
  ): Promise<GatewaySubscription | null | 'error'> {
    if (
      !sub.gatewaySubscriptionId ||
      sub.gatewayProvider !== this.gateway.providerId
    ) {
      return null;
    }
    const cached = this.subscriptionCache.get(sub.gatewaySubscriptionId);
    if (cached !== undefined) return cached;
    try {
      const remote = await this.gateway.getSubscriptionWithDiscount(
        sub.gatewaySubscriptionId,
      );
      this.subscriptionCache.set(
        sub.gatewaySubscriptionId,
        remote,
        SUBSCRIPTION_CACHE_TTL_MS,
      );
      return remote;
    } catch (err) {
      this.logger.warn(
        `[admin-revenue] assinatura ${sub.gatewaySubscriptionId} indisponível na Stripe: ${errorMessage(err)}`,
      );
      return 'error';
    }
  }

  private async toForecastInput(
    sub: Subscription,
    now: Date,
    windowEnd: Date,
  ): Promise<{ input: ForecastSubscription | null; partial: boolean }> {
    if (
      !sub.gatewaySubscriptionId ||
      sub.gatewayProvider !== this.gateway.providerId
    ) {
      return { input: null, partial: false };
    }
    const fetched = await this.readRemote(sub);
    let partial = fetched === 'error';
    const remote = fetched === 'error' ? null : fetched;

    const isTrial =
      isActiveInTrial(sub, now) || remote?.providerStatus === 'trialing';
    if (remote) {
      const status = remote.providerStatus ?? remote.status;
      if (status !== 'active' && status !== 'trialing') {
        return { input: null, partial };
      }
    } else if (sub.status !== SubscriptionStatus.ACTIVE) {
      return { input: null, partial };
    }

    if (isTrial) {
      const customerId = sub.gatewayCustomerId ?? remote?.customerId ?? null;
      if (!customerId) return { input: null, partial };
      try {
        const payment =
          await this.gateway.getCustomerPaymentSummary(customerId);
        if (!payment.hasPaymentMethod) return { input: null, partial };
      } catch (err) {
        this.logger.warn(
          `[admin-revenue] cartão de ${customerId} indisponível na Stripe: ${errorMessage(err)}`,
        );
        return { input: null, partial: true };
      }
    }

    const firstChargeAt = isTrial
      ? (remote?.trialEndsAt ?? sub.trialEndsAt)
      : (remote?.currentPeriodEnd ?? sub.currentPeriodEnd);
    if (!firstChargeAt) return { input: null, partial };

    const cancelAtPeriodEnd = remote
      ? remote.cancelAtPeriodEnd
      : sub.cancelAtPeriodEnd;

    const firstChargeInWindow =
      firstChargeAt.getTime() >= now.getTime() &&
      firstChargeAt.getTime() < windowEnd.getTime();
    let previewAmountCents: number | null = null;
    if (!cancelAtPeriodEnd && firstChargeInWindow) {
      try {
        const preview = await this.gateway.previewNextInvoice(
          sub.gatewaySubscriptionId,
        );
        previewAmountCents = preview?.amountDueCents ?? null;
      } catch (err) {
        partial = true;
        this.logger.warn(
          `[admin-revenue] prévia de ${sub.gatewaySubscriptionId} indisponível, usando projeção: ${errorMessage(err)}`,
        );
      }
    }

    return {
      partial,
      input: {
        ownerId: sub.ownerId,
        name: sub.owner?.name ?? '',
        email: sub.owner?.email ?? '',
        kind: isTrial ? 'trial_conversion' : 'guaranteed',
        firstChargeAt,
        cycle: remote?.cycle ?? sub.plan.billingPeriod,
        priceCents: remote ? remote.amountCents : sub.plan.priceCents,
        discount:
          remote && remote.discount !== undefined
            ? remote.discount
            : subscriptionDiscount(sub),
        cancelAtPeriodEnd,
        cancelAt: remote?.cancelAt ?? null,
        previewAmountCents,
      },
    };
  }

  private monthKeysEndingAt(monthKey: string, count: number): string[] {
    const keys = [monthKey];
    let cursor = saoPauloMonthRangeOf(monthKey).from;
    while (keys.length < count) {
      cursor = saoPauloMonthRange(new Date(cursor.getTime() - 1)).from;
      keys.unshift(saoPauloMonthKey(cursor));
    }
    return keys;
  }
}
