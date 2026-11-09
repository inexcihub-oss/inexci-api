import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AdminMetricsRepository,
  PlatformMetricsDailyValues,
} from 'src/database/repositories/admin-metrics.repository';
import {
  AdminAccountSituationKey,
  AdminAccountsRepository,
} from 'src/database/repositories/admin-accounts.repository';
import { AdminRevenueRepository } from 'src/database/repositories/admin-revenue.repository';
import {
  ADMIN_TIME_ZONE,
  AdminAccountSituation,
  formatSaoPauloDate,
} from '../accounts/admin-account-situation';
import { summarizeMrr } from '../revenue/admin-revenue.service';
import { saoPauloDayRangeOf, shiftDayKey } from './metrics-formulas';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SITUATION_ORDER = Object.values(
  AdminAccountSituation,
) as AdminAccountSituationKey[];

@Injectable()
export class MetricsSnapshotService {
  private readonly logger = new Logger(MetricsSnapshotService.name);

  constructor(
    private readonly metrics: AdminMetricsRepository,
    private readonly accounts: AdminAccountsRepository,
    private readonly revenueRepo: AdminRevenueRepository,
  ) {}

  @Cron('30 0 * * *', { timeZone: ADMIN_TIME_ZONE })
  async handleDailySnapshot(): Promise<void> {
    try {
      const row = await this.snapshotPreviousDay();
      this.logger.log(
        `[metrics-snapshot] ${row.day}: ${row.accountsTotal} contas, MRR ${row.mrrCents}`,
      );
    } catch (err) {
      this.logger.error(
        `[metrics-snapshot] falha ao gravar o snapshot: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async snapshotPreviousDay(
    now: Date = new Date(),
  ): Promise<PlatformMetricsDailyValues> {
    const day = shiftDayKey(formatSaoPauloDate(now), -1);
    const dayRange = saoPauloDayRangeOf(day);
    const [
      accountsTotal,
      situations,
      revenueSubs,
      newAccounts,
      canceledAccounts,
      active7,
      active30,
    ] = await Promise.all([
      this.accounts.countClients(),
      this.accounts.countBySituation({ now }),
      this.revenueRepo.findRevenueSubscriptions(),
      this.metrics.countCreatedBetween(dayRange),
      this.metrics.countCanceledBetween(dayRange),
      this.accounts.countClientsSeenSince(
        new Date(now.getTime() - 7 * MS_PER_DAY),
      ),
      this.accounts.countClientsSeenSince(
        new Date(now.getTime() - 30 * MS_PER_DAY),
      ),
    ]);

    const counts = new Map(situations.map((s) => [s.situation, s.count]));
    const bySituation = Object.fromEntries(
      SITUATION_ORDER.map((s) => [s, counts.get(s) ?? 0]),
    );
    const mrr = summarizeMrr(revenueSubs, now);
    const row: PlatformMetricsDailyValues = {
      day,
      accountsTotal,
      accountsBySituation: bySituation,
      mrrCents: mrr.mrrCents,
      payingAccounts: mrr.payingAccounts,
      trialAccounts: bySituation.trial,
      newAccounts,
      canceledAccounts,
      activeAccounts7d: active7,
      activeAccounts30d: active30,
    };
    await this.metrics.upsertSnapshot(row);
    return row;
  }
}
