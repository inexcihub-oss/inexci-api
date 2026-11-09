import { Logger } from '@nestjs/common';
import type {
  AdminMetricsRepository,
  PlatformMetricsDailyValues,
} from '../repositories/admin-metrics.repository';
import { formatSaoPauloDate } from '../../modules/admin/accounts/admin-account-situation';
import {
  saoPauloDayRangeOf,
  shiftDayKey,
} from '../../modules/admin/metrics/metrics-formulas';
import { parseBackfillArgs } from './backfill-invoices';

type BackfillMetricsRepo = Pick<
  AdminMetricsRepository,
  | 'earliestClientCreatedAt'
  | 'countCreatedBetween'
  | 'countCanceledBetween'
  | 'reconstructMrrAt'
  | 'upsertReconstructedSnapshot'
>;

export interface BackfillMetricsDeps {
  repo: BackfillMetricsRepo;
  fromDay?: string;
  now?: Date;
  log: (message: string) => void;
}

export interface BackfillMetricsResult {
  days: number;
  written: number;
  skipped: number;
}

const MAX_DAYS = 3660;

export async function reconstructDay(
  repo: BackfillMetricsRepo,
  day: string,
): Promise<PlatformMetricsDailyValues> {
  const range = saoPauloDayRangeOf(day);
  const [accountsTotal, newAccounts, canceledAccounts, mrr] = await Promise.all(
    [
      repo.countCreatedBetween({ to: range.to }),
      repo.countCreatedBetween(range),
      repo.countCanceledBetween(range),
      repo.reconstructMrrAt(range.to),
    ],
  );
  return {
    day,
    accountsTotal,
    accountsBySituation: null,
    mrrCents: mrr.mrrCents,
    payingAccounts: mrr.payingAccounts,
    trialAccounts: null,
    newAccounts,
    canceledAccounts,
    activeAccounts7d: null,
    activeAccounts30d: null,
  };
}

export async function backfillMetrics(
  deps: BackfillMetricsDeps,
): Promise<BackfillMetricsResult> {
  const result: BackfillMetricsResult = { days: 0, written: 0, skipped: 0 };
  const lastDay = shiftDayKey(formatSaoPauloDate(deps.now ?? new Date()), -1);
  let day = deps.fromDay;
  if (!day) {
    const earliest = await deps.repo.earliestClientCreatedAt();
    if (!earliest) return result;
    day = formatSaoPauloDate(earliest);
  }

  while (day <= lastDay && result.days < MAX_DAYS) {
    const row = await reconstructDay(deps.repo, day);
    const written = await deps.repo.upsertReconstructedSnapshot(row);
    result.days++;
    if (written) result.written++;
    else result.skipped++;
    day = shiftDayKey(day, 1);
  }
  deps.log(
    `métricas: ${result.days} dias, ${result.written} gravados, ${result.skipped} já gravados pelo cron`,
  );
  return result;
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillMetrics');
  const { createdFrom } = parseBackfillArgs(process.argv.slice(2));

  const { SeedDataSource } = await import('../typeorm/seed-data-source');
  const { Subscription } = await import('../entities/subscription.entity');
  const { AdminMetricsRepository } =
    await import('../repositories/admin-metrics.repository');

  await SeedDataSource.initialize();
  try {
    const repo = new AdminMetricsRepository(
      SeedDataSource.getRepository(Subscription),
    );
    await backfillMetrics({
      repo,
      fromDay: createdFrom?.toISOString().slice(0, 10),
      log: (message) => logger.log(message),
    });
  } finally {
    await SeedDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('BackfillMetrics').error(
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
