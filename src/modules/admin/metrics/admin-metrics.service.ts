import { Injectable } from '@nestjs/common';
import { AdminMetricsRepository } from 'src/database/repositories/admin-metrics.repository';
import {
  AdminAccountSituationKey,
  AdminAccountsRepository,
} from 'src/database/repositories/admin-accounts.repository';
import { AdminUsageRepository } from 'src/database/repositories/admin-usage.repository';
import { AdminRevenueRepository } from 'src/database/repositories/admin-revenue.repository';
import { AiTokenUsageLogRepository } from 'src/database/repositories/ai-token-usage-log.repository';
import {
  AdminAccountSituation,
  formatSaoPauloDate,
  saoPauloMonthKey,
  saoPauloMonthRange,
  saoPauloMonthRangeOf,
} from '../accounts/admin-account-situation';
import {
  AdminRevenueService,
  summarizeMrr,
} from '../revenue/admin-revenue.service';
import { nextMonthForecast } from '../revenue/revenue-forecast';
import {
  MetricsPeriod,
  SNAPSHOT_TOLERANCE_DAYS,
  changePercent,
  lostMrrCents,
  monthKeysEndingAt,
  mrrMonthlySeries,
  periodStart,
  ratePercent,
  shiftDayKey,
  snapshotOnOrBefore,
} from './metrics-formulas';
import { AdminMetricsOverviewDto } from './dto/admin-metrics-response.dto';
import { PlatformErrorDailyRepository } from 'src/database/repositories/platform-error-daily.repository';
import { AccountHealthService } from '../health/account-health.service';
import { AdminActivationService } from '../activation/admin-activation.service';
import { AdminSecurityService } from '../security/admin-security.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SERIES_MONTHS = 12;
const CONVERSION_WINDOW_DAYS = 90;
const CONVERSION_MIN_AGE_DAYS = 15;
const TRIAL_ENDING_DAYS = 7;
const TOP_AI_ACCOUNTS = 5;
export const ERROR_SPIKE_THRESHOLD = 10;
const ERROR_SPIKE_TOP = 5;
const ACCOUNTS_AT_RISK_TOP = 5;
const SITUATION_ORDER = Object.values(
  AdminAccountSituation,
) as AdminAccountSituationKey[];

const sumCounts = (rows: Array<{ count: number }>): number =>
  rows.reduce((total, r) => total + r.count, 0);

const minDay = (...days: string[]): string =>
  days.reduce((min, d) => (d < min ? d : min));

@Injectable()
export class AdminMetricsService {
  constructor(
    private readonly metrics: AdminMetricsRepository,
    private readonly accounts: AdminAccountsRepository,
    private readonly usage: AdminUsageRepository,
    private readonly revenueRepo: AdminRevenueRepository,
    private readonly revenue: AdminRevenueService,
    private readonly ai: AiTokenUsageLogRepository,
    private readonly errors: PlatformErrorDailyRepository,
    private readonly health: AccountHealthService,
    private readonly activation: AdminActivationService,
    private readonly security: AdminSecurityService,
  ) {}

  async getOverview(
    period: MetricsPeriod,
    now: Date = new Date(),
  ): Promise<AdminMetricsOverviewDto> {
    await this.health.ensureFresh(now);
    const from = periodStart(period, now);
    const range = { from, to: now };
    const month = saoPauloMonthRange(now);
    const monthKey = saoPauloMonthKey(now);
    const todayKey = formatSaoPauloDate(now);
    const previousDay = shiftDayKey(formatSaoPauloDate(from), -1);
    const monthStartDay = shiftDayKey(formatSaoPauloDate(month.from), -1);
    const seriesKeys = monthKeysEndingAt(monthKey, SERIES_MONTHS);
    const seriesFrom = saoPauloMonthRangeOf(seriesKeys[0]).from;
    const snapshotsFrom = minDay(
      `${seriesKeys[0]}-01`,
      shiftDayKey(previousDay, -SNAPSHOT_TOLERANCE_DAYS),
      shiftDayKey(monthStartDay, -SNAPSHOT_TOLERANCE_DAYS),
    );
    const conversionRange = {
      from: new Date(now.getTime() - CONVERSION_WINDOW_DAYS * MS_PER_DAY),
      to: new Date(now.getTime() - CONVERSION_MIN_AGE_DAYS * MS_PER_DAY),
    };
    const last30From = new Date(now.getTime() - 30 * MS_PER_DAY);

    const [
      totalClients,
      newInPeriod,
      situations,
      trialsEnding,
      conversion,
      funnel,
      revenueSubs,
      received,
      delinquency,
      payingCanceled,
      snapshots,
      active7,
      active30,
      surgeryRequests,
      appointments,
      patients,
      aiCost,
      topAi,
      monthlyCreated,
      monthlyCanceled,
      byPlan,
      inactive7,
      errorSpikes,
      atRisk,
      activationCohort,
      securitySpike,
    ] = await Promise.all([
      this.accounts.countClients(),
      this.metrics.countCreatedBetween(range),
      this.accounts.countBySituation({ now }),
      this.accounts.findPage({
        trialEndingInDays: TRIAL_ENDING_DAYS,
        sortBy: 'trialEndsAt',
        sortDir: 'ASC',
        limit: 1,
        offset: 0,
        now,
      }),
      this.metrics.trialCohort(conversionRange),
      this.metrics.trialCohort(range),
      this.revenueRepo.findRevenueSubscriptions(),
      this.revenueRepo.sumPaidBetween(month.from, month.to),
      this.revenue.getDelinquency(now),
      this.metrics.findPayingCanceledBetween({ from: month.from, to: now }),
      this.metrics.findSnapshotsBetween(snapshotsFrom, todayKey),
      this.accounts.countClientsSeenSince(
        new Date(now.getTime() - 7 * MS_PER_DAY),
      ),
      this.accounts.countClientsSeenSince(last30From),
      this.usage.weeklySurgeryRequestsCreated(range),
      this.usage.weeklyAppointmentsByStatus(range),
      this.usage.weeklyPatientsCreated(range),
      this.ai.costSummary(month, last30From),
      this.ai.topOwnersByCost(month, TOP_AI_ACCOUNTS),
      this.metrics.monthlyCreated(seriesFrom),
      this.metrics.monthlyCanceled(seriesFrom),
      this.metrics.accountsByPlan(),
      this.accounts.countInactiveClients(7, now),
      this.errors.accountsWithSpike(
        new Date(now.getTime() - MS_PER_DAY),
        shiftDayKey(formatSaoPauloDate(now), -1),
        ERROR_SPIKE_THRESHOLD,
        ERROR_SPIKE_TOP,
      ),
      this.health.atRisk(ACCOUNTS_AT_RISK_TOP),
      this.activation.cohort(range),
      this.security.spike(now),
    ]);

    const situationCount = new Map(
      situations.map((s) => [s.situation, s.count]),
    );
    const mrr = summarizeMrr(revenueSubs, now);
    const forecast = nextMonthForecast(revenueSubs, now);
    const previousSnapshot = snapshotOnOrBefore(snapshots, previousDay);
    const monthStartSnapshot = snapshotOnOrBefore(snapshots, monthStartDay);
    const lost = lostMrrCents(payingCanceled);
    const createdByMonth = new Map(
      monthlyCreated.map((r) => [r.month, r.count]),
    );
    const canceledByMonth = new Map(
      monthlyCanceled.map((r) => [r.month, r.count]),
    );

    return {
      period,
      from,
      to: now,
      accounts: {
        total: totalClients,
        newInPeriod,
        bySituation: SITUATION_ORDER.map((situation) => ({
          situation,
          count: situationCount.get(situation) ?? 0,
        })),
      },
      trials: {
        active: situationCount.get('trial') ?? 0,
        endingIn7Days: trialsEnding.total,
        expired: situationCount.get('trial_expired') ?? 0,
        conversion90d: {
          cohortFrom: conversionRange.from,
          cohortTo: conversionRange.to,
          started: conversion.started,
          converted: conversion.converted,
          ratePercent: ratePercent(conversion.converted, conversion.started),
        },
      },
      revenue: {
        mrrCents: mrr.mrrCents,
        payingAccounts: mrr.payingAccounts,
        mrrPreviousCents: previousSnapshot?.mrrCents ?? null,
        mrrChangePercent: changePercent(
          mrr.mrrCents,
          previousSnapshot?.mrrCents ?? null,
        ),
        month: monthKey,
        receivedThisMonthCents: received.receivedCents,
        nextMonth: forecast.month,
        nextMonthForecastCents: forecast.totalCents,
        nextMonthForecastGuaranteedCents: forecast.guaranteedCents,
        nextMonthForecastTrialConversionCents: forecast.trialConversionCents,
        nextMonthForecastIsEstimate: true,
        delinquentCents: delinquency.totalOpenCents,
        delinquentAccounts: delinquency.items.length,
      },
      churn: {
        month: monthKey,
        canceledAccounts: payingCanceled.length,
        payingAccountsAtStart: monthStartSnapshot?.payingAccounts ?? null,
        accountsRatePercent: ratePercent(
          payingCanceled.length,
          monthStartSnapshot?.payingAccounts ?? null,
        ),
        lostMrrCents: lost,
        mrrAtStartCents: monthStartSnapshot?.mrrCents ?? null,
        revenueRatePercent: ratePercent(
          lost,
          monthStartSnapshot?.mrrCents ?? null,
        ),
      },
      engagement: {
        activeAccounts7d: active7,
        activeAccounts30d: active30,
        inactiveAccounts7d: inactive7,
        surgeryRequestsCreated: sumCounts(surgeryRequests),
        appointments: sumCounts(appointments),
        patientsCreated: sumCounts(patients),
      },
      ai: {
        costMonthUsdCents: aiCost.clientMonthUsdCents,
        platformCostMonthUsdCents: aiCost.platformMonthUsdCents,
        costLast30DaysUsdCents: aiCost.clientLast30DaysUsdCents,
        averageCostPerActiveAccountUsdCents: active30
          ? Math.round(aiCost.clientLast30DaysUsdCents / active30)
          : null,
        topAccounts: topAi,
      },
      errors: {
        spikeThreshold: ERROR_SPIKE_THRESHOLD,
        accountsWithSpike24h: errorSpikes.accounts,
        topSpikeAccounts: errorSpikes.top,
      },
      activation: activationCohort,
      security: securitySpike,
      accountsAtRisk: {
        total: atRisk.total,
        items: atRisk.items.map((item) => ({
          ownerId: item.ownerId,
          name: item.name,
          score: item.score,
          mainReason: item.factors[0]?.message ?? null,
        })),
      },
      series: {
        mrrMonthly: mrrMonthlySeries(
          seriesKeys,
          snapshots,
          monthKey,
          mrr.mrrCents,
        ),
        newVsCanceled: seriesKeys.map((key) => ({
          month: key,
          newAccounts: createdByMonth.get(key) ?? 0,
          canceledAccounts: canceledByMonth.get(key) ?? 0,
        })),
        accountsByPlan: byPlan,
        trialFunnel: funnel,
      },
    };
  }
}
