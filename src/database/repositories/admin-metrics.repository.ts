import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import type { BillingPeriod } from '../entities/subscription-plan.entity';
import {
  PlatformMetricsBySituation,
  PlatformMetricsDaily,
} from '../entities/platform-metrics-daily.entity';
import { CLIENT_OWNER_IDS_SQL, TIME_ZONE } from './admin-accounts.repository';
import { BaseRepository } from './base.repository';

export interface AdminMetricsRange {
  from: Date;
  to: Date;
}

export interface AdminTrialCohort {
  started: number;
  withCard: number;
  converted: number;
}

export interface AdminMonthlyCountRow {
  month: string;
  count: number;
}

export interface AdminPlanAccountsRow {
  planId: string;
  planName: string;
  billingPeriod: BillingPeriod;
  accounts: number;
}

export interface PlatformMetricsDailyValues {
  day: string;
  accountsTotal: number;
  accountsBySituation: PlatformMetricsBySituation | null;
  mrrCents: number;
  payingAccounts: number;
  trialAccounts: number | null;
  newAccounts: number;
  canceledAccounts: number;
  activeAccounts7d: number | null;
  activeAccounts30d: number | null;
}

const PAID_INVOICE_SQL =
  "SELECT 1 FROM gateway_invoices pi WHERE pi.owner_id = s.ownerId AND pi.status = 'paid' AND pi.amount_paid_cents > 0";

const MONTHLY_WINDOW = "INTERVAL '35 days'";
const YEARLY_WINDOW = "INTERVAL '370 days'";

const RECONSTRUCT_MRR_SQL = `SELECT COALESCE(SUM(x.mrr), 0) AS mrr, COUNT(*) FILTER (WHERE x.mrr > 0) AS paying
FROM (
  SELECT DISTINCT ON (gi.owner_id) gi.owner_id,
    CASE WHEN p.billing_period = 'YEARLY' THEN FLOOR(gi.amount_paid_cents / 12.0) ELSE gi.amount_paid_cents END AS mrr
  FROM gateway_invoices gi
  INNER JOIN subscriptions s ON s.owner_id = gi.owner_id
  INNER JOIN subscription_plans p ON p.id = s.plan_id
  WHERE gi.status = 'paid'
    AND gi.amount_paid_cents > 0
    AND gi.owner_id IN ${CLIENT_OWNER_IDS_SQL}
    AND gi.paid_at < $1::timestamptz
    AND gi.paid_at >= $1::timestamptz - (CASE WHEN p.billing_period = 'YEARLY' THEN ${YEARLY_WINDOW} ELSE ${MONTHLY_WINDOW} END)
    AND NOT (s.status = 'canceled' AND s.canceled_at IS NOT NULL AND s.canceled_at < $1::timestamptz)
  ORDER BY gi.owner_id, gi.paid_at DESC
) x`;

const SNAPSHOT_COLUMNS = [
  'day',
  'accounts_total',
  'accounts_by_situation',
  'mrr_cents',
  'paying_accounts',
  'trial_accounts',
  'new_accounts',
  'canceled_accounts',
  'active_accounts_7d',
  'active_accounts_30d',
] as const;

function upsertSnapshotSql(onlyReconstructed: boolean): string {
  const columns = SNAPSHOT_COLUMNS.map((c) => `"${c}"`).join(', ');
  const values = SNAPSHOT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
  const updates = SNAPSHOT_COLUMNS.filter((c) => c !== 'day')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');
  const guard = onlyReconstructed
    ? ' WHERE "platform_metrics_daily"."active_accounts_30d" IS NULL'
    : '';
  return `INSERT INTO "platform_metrics_daily" (${columns}) VALUES (${values}) ON CONFLICT ("day") DO UPDATE SET ${updates}${guard} RETURNING "day"`;
}

function snapshotParams(row: PlatformMetricsDailyValues): unknown[] {
  return [
    row.day,
    row.accountsTotal,
    row.accountsBySituation ? JSON.stringify(row.accountsBySituation) : null,
    row.mrrCents,
    row.payingAccounts,
    row.trialAccounts,
    row.newAccounts,
    row.canceledAccounts,
    row.activeAccounts7d,
    row.activeAccounts30d,
  ];
}

const toInt = (value: unknown): number => Number(value ?? 0) || 0;

function monthExpression(column: string): string {
  return `to_char(${column} AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM')`;
}

@Injectable()
export class AdminMetricsRepository extends BaseRepository<Subscription> {
  constructor(@InjectRepository(Subscription) repo: Repository<Subscription>) {
    super(repo);
  }

  private clientSubscriptions(): SelectQueryBuilder<Subscription> {
    return this.repository
      .createQueryBuilder('s')
      .where(`s.ownerId IN ${CLIENT_OWNER_IDS_SQL}`);
  }

  async countCreatedBetween(range: { from?: Date; to: Date }): Promise<number> {
    const qb = this.clientSubscriptions().andWhere('s.createdAt < :to', {
      to: range.to,
    });
    if (range.from) {
      qb.andWhere('s.createdAt >= :from', { from: range.from });
    }
    const raw = await qb
      .select('COUNT(*)', 'count')
      .getRawOne<{ count: string }>();
    return toInt(raw?.count);
  }

  async countCanceledBetween(range: AdminMetricsRange): Promise<number> {
    const raw = await this.clientSubscriptions()
      .andWhere('s.status = :canceled', {
        canceled: SubscriptionStatus.CANCELED,
      })
      .andWhere('s.canceledAt >= :from AND s.canceledAt < :to', range)
      .select('COUNT(*)', 'count')
      .getRawOne<{ count: string }>();
    return toInt(raw?.count);
  }

  async trialCohort(range: AdminMetricsRange): Promise<AdminTrialCohort> {
    const raw = await this.clientSubscriptions()
      .andWhere('s.createdAt >= :from AND s.createdAt < :to', range)
      .select('COUNT(*)', 'started')
      .addSelect(
        'COUNT(*) FILTER (WHERE s.gatewaySubscriptionId IS NOT NULL)',
        'withCard',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE EXISTS (${PAID_INVOICE_SQL}))`,
        'converted',
      )
      .getRawOne<{ started: string; withCard: string; converted: string }>();
    return {
      started: toInt(raw?.started),
      withCard: toInt(raw?.withCard),
      converted: toInt(raw?.converted),
    };
  }

  findPayingCanceledBetween(range: AdminMetricsRange): Promise<Subscription[]> {
    return this.clientSubscriptions()
      .innerJoinAndSelect('s.plan', 'p')
      .andWhere('s.status = :canceled', {
        canceled: SubscriptionStatus.CANCELED,
      })
      .andWhere('s.canceledAt >= :from AND s.canceledAt < :to', range)
      .andWhere(`EXISTS (${PAID_INVOICE_SQL} AND pi.paid_at < :from)`)
      .orderBy('s.canceledAt', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .getMany();
  }

  async monthlyCreated(from: Date): Promise<AdminMonthlyCountRow[]> {
    const expr = monthExpression('s.createdAt');
    const rows = await this.clientSubscriptions()
      .andWhere('s.createdAt >= :from', { from })
      .select(expr, 'month')
      .addSelect('COUNT(*)', 'count')
      .groupBy(expr)
      .orderBy('month', 'ASC')
      .getRawMany<{ month: string; count: string }>();
    return rows.map((r) => ({ month: r.month, count: toInt(r.count) }));
  }

  async monthlyCanceled(from: Date): Promise<AdminMonthlyCountRow[]> {
    const expr = monthExpression('s.canceledAt');
    const rows = await this.clientSubscriptions()
      .andWhere('s.status = :canceled', {
        canceled: SubscriptionStatus.CANCELED,
      })
      .andWhere('s.canceledAt >= :from', { from })
      .select(expr, 'month')
      .addSelect('COUNT(*)', 'count')
      .groupBy(expr)
      .orderBy('month', 'ASC')
      .getRawMany<{ month: string; count: string }>();
    return rows.map((r) => ({ month: r.month, count: toInt(r.count) }));
  }

  async accountsByPlan(): Promise<AdminPlanAccountsRow[]> {
    const rows = await this.clientSubscriptions()
      .innerJoin('s.plan', 'p')
      .andWhere('s.status NOT IN (:...excluded)', {
        excluded: [SubscriptionStatus.CANCELED, SubscriptionStatus.INTERNAL],
      })
      .select('p.id', 'planId')
      .addSelect('p.name', 'planName')
      .addSelect('p.billingPeriod', 'billingPeriod')
      .addSelect('COUNT(*)', 'accounts')
      .groupBy('p.id')
      .addGroupBy('p.name')
      .addGroupBy('p.billingPeriod')
      .orderBy('accounts', 'DESC')
      .addOrderBy('p.name', 'ASC')
      .getRawMany<{
        planId: string;
        planName: string;
        billingPeriod: BillingPeriod;
        accounts: string;
      }>();
    return rows.map((r) => ({
      planId: r.planId,
      planName: r.planName,
      billingPeriod: r.billingPeriod,
      accounts: toInt(r.accounts),
    }));
  }

  async reconstructMrrAt(
    at: Date,
  ): Promise<{ mrrCents: number; payingAccounts: number }> {
    const rows: Array<{ mrr: string; paying: string }> =
      await this.repository.manager.query(RECONSTRUCT_MRR_SQL, [at]);
    return {
      mrrCents: toInt(rows[0]?.mrr),
      payingAccounts: toInt(rows[0]?.paying),
    };
  }

  async earliestClientCreatedAt(): Promise<Date | null> {
    const raw = await this.clientSubscriptions()
      .select('MIN(s.createdAt)', 'min')
      .getRawOne<{ min: Date | string | null }>();
    return raw?.min ? new Date(raw.min) : null;
  }

  findSnapshotsBetween(
    fromDay: string,
    toDay: string,
  ): Promise<PlatformMetricsDaily[]> {
    return this.repository.manager
      .getRepository(PlatformMetricsDaily)
      .createQueryBuilder('m')
      .where('m.day >= :fromDay AND m.day <= :toDay', { fromDay, toDay })
      .orderBy('m.day', 'ASC')
      .getMany();
  }

  async upsertSnapshot(row: PlatformMetricsDailyValues): Promise<void> {
    await this.repository.manager.query(
      upsertSnapshotSql(false),
      snapshotParams(row),
    );
  }

  async upsertReconstructedSnapshot(
    row: PlatformMetricsDailyValues,
  ): Promise<boolean> {
    const rows: unknown[] = await this.repository.manager.query(
      upsertSnapshotSql(true),
      snapshotParams(row),
    );
    return rows.length > 0;
  }
}
