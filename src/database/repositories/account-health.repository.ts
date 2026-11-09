import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AccountHealthBand,
  AccountHealthDaily,
  AccountHealthFactor,
} from '../entities/account-health-daily.entity';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { SubscriptionQuotaPeriod } from '../entities/subscription-quota-period.entity';
import { User } from '../entities/user.entity';
import { SurgeryRequest } from '../entities/surgery-request.entity';
import { Appointment } from '../entities/appointment.entity';
import { PlatformErrorDaily } from '../entities/platform-error-daily.entity';
import {
  NotificationSendLog,
  NotificationSendStatus,
} from '../entities/notification-send-log.entity';
import { BaseRepository } from './base.repository';

export const LATEST_HEALTH_DAY_SQL =
  '(SELECT MAX(hd.day) FROM account_health_daily hd)';
export const HEALTH_SCORE_SQL = `(SELECT h.score FROM account_health_daily h WHERE h.owner_id = s.ownerId AND h.day = ${LATEST_HEALTH_DAY_SQL})`;
export const HEALTH_BAND_SQL = `(SELECT h.band FROM account_health_daily h WHERE h.owner_id = s.ownerId AND h.day = ${LATEST_HEALTH_DAY_SQL})`;

export interface AccountHealthInput {
  ownerId: string;
  ownerCreatedAt: Date;
  deactivated: boolean;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  hasGatewaySubscription: boolean;
  pastDueSince: Date | null;
  lastSeenAt: Date | null;
  usageCurrent: number;
  usagePrevious: number;
  quotaUsed: number | null;
  quotaLimit: number | null;
  errors: number;
  deliveryFailures: number;
}

export interface AccountHealthInputWindow {
  now: Date;
  usageCurrentFrom: Date;
  usagePreviousFrom: Date;
  errorsFromDay: string;
  deliveryFrom: Date;
}

export interface AccountHealthRowValues {
  ownerId: string;
  day: string;
  score: number;
  band: AccountHealthBand;
  factors: AccountHealthFactor[];
  computedAt: Date;
}

export interface AccountHealthHistoryPoint {
  day: string;
  score: number;
  band: AccountHealthBand;
}

export interface AccountAtRiskRow {
  ownerId: string;
  name: string;
  score: number;
  factors: AccountHealthFactor[];
}

const UPSERT_COLUMNS = 6;

function toInt(value: string | number | null | undefined): number {
  return Number(value ?? 0) || 0;
}

@Injectable()
export class AccountHealthRepository extends BaseRepository<AccountHealthDaily> {
  constructor(
    @InjectRepository(AccountHealthDaily)
    repository: Repository<AccountHealthDaily>,
  ) {
    super(repository);
  }

  async loadInputs(
    window: AccountHealthInputWindow,
    ownerIds?: string[],
  ): Promise<AccountHealthInput[]> {
    if (ownerIds && ownerIds.length === 0) return [];
    const em = this.repository.manager;
    const onlyOwners = ownerIds !== undefined;

    const subsQb = em
      .createQueryBuilder(Subscription, 's')
      .innerJoin('s.owner', 'o')
      .select('s.ownerId', 'ownerId')
      .addSelect('s.id', 'subscriptionId')
      .addSelect('s.status', 'status')
      .addSelect('s.trialEndsAt', 'trialEndsAt')
      .addSelect('s.gatewaySubscriptionId', 'gatewaySubscriptionId')
      .addSelect('s.pastDueSince', 'pastDueSince')
      .addSelect('o.createdAt', 'ownerCreatedAt')
      .addSelect('o.accountDeactivatedAt', 'deactivatedAt')
      .where('o.ownerId = o.id')
      .orderBy('s.ownerId', 'ASC')
      .addOrderBy('s.createdAt', 'DESC');
    if (onlyOwners)
      subsQb.andWhere('s.ownerId IN (:...ownerIds)', { ownerIds });

    const lastSeenQb = em
      .createQueryBuilder(User, 'u')
      .select('u.ownerId', 'ownerId')
      .addSelect('MAX(u.lastSeenAt)', 'lastSeen')
      .where('u.ownerId IS NOT NULL')
      .groupBy('u.ownerId');
    if (onlyOwners)
      lastSeenQb.andWhere('u.ownerId IN (:...ownerIds)', { ownerIds });

    const usageParams = {
      currentFrom: window.usageCurrentFrom,
      previousFrom: window.usagePreviousFrom,
      usageNow: window.now,
    };
    const srQb = em
      .createQueryBuilder(SurgeryRequest, 'sr')
      .select('sr.ownerId', 'ownerId')
      .addSelect(
        'COUNT(*) FILTER (WHERE sr.createdAt >= :currentFrom)',
        'current',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE sr.createdAt < :currentFrom)',
        'previous',
      )
      .where('sr.createdAt >= :previousFrom AND sr.createdAt < :usageNow')
      .setParameters(usageParams)
      .groupBy('sr.ownerId');
    if (onlyOwners) srQb.andWhere('sr.ownerId IN (:...ownerIds)', { ownerIds });

    const apQb = em
      .createQueryBuilder(Appointment, 'ap')
      .select('ap.ownerId', 'ownerId')
      .addSelect(
        'COUNT(*) FILTER (WHERE ap.createdAt >= :currentFrom)',
        'current',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE ap.createdAt < :currentFrom)',
        'previous',
      )
      .where('ap.createdAt >= :previousFrom AND ap.createdAt < :usageNow')
      .setParameters(usageParams)
      .groupBy('ap.ownerId');
    if (onlyOwners) apQb.andWhere('ap.ownerId IN (:...ownerIds)', { ownerIds });

    const errorsQb = em
      .createQueryBuilder(PlatformErrorDaily, 'e')
      .select('e.ownerId', 'ownerId')
      .addSelect('SUM(e.count)', 'total')
      .where('e.ownerId IS NOT NULL')
      .andWhere('e.day >= :errorsFromDay', {
        errorsFromDay: window.errorsFromDay,
      })
      .groupBy('e.ownerId');
    if (onlyOwners)
      errorsQb.andWhere('e.ownerId IN (:...ownerIds)', { ownerIds });

    const deliveryQb = em
      .createQueryBuilder(NotificationSendLog, 'l')
      .select('l.ownerId', 'ownerId')
      .addSelect('COUNT(*)', 'total')
      .where('l.ownerId IS NOT NULL')
      .andWhere('l.status = :failed', {
        failed: NotificationSendStatus.FAILED,
      })
      .andWhere('l.createdAt >= :deliveryFrom', {
        deliveryFrom: window.deliveryFrom,
      })
      .groupBy('l.ownerId');
    if (onlyOwners)
      deliveryQb.andWhere('l.ownerId IN (:...ownerIds)', { ownerIds });

    const [subs, lastSeen, sr, ap, errors, delivery] = await Promise.all([
      subsQb.getRawMany<{
        ownerId: string;
        subscriptionId: string;
        status: SubscriptionStatus;
        trialEndsAt: Date | null;
        gatewaySubscriptionId: string | null;
        pastDueSince: Date | null;
        ownerCreatedAt: Date;
        deactivatedAt: Date | null;
      }>(),
      lastSeenQb.getRawMany<{ ownerId: string; lastSeen: Date | null }>(),
      srQb.getRawMany<{ ownerId: string; current: string; previous: string }>(),
      apQb.getRawMany<{ ownerId: string; current: string; previous: string }>(),
      errorsQb.getRawMany<{ ownerId: string; total: string }>(),
      deliveryQb.getRawMany<{ ownerId: string; total: string }>(),
    ]);

    const latestSubs = new Map<string, (typeof subs)[number]>();
    for (const row of subs) {
      if (!latestSubs.has(row.ownerId)) latestSubs.set(row.ownerId, row);
    }
    const quota = await this.currentQuota(
      [...latestSubs.values()].map((r) => r.subscriptionId),
      window.now,
    );

    const lastSeenMap = new Map(lastSeen.map((r) => [r.ownerId, r.lastSeen]));
    const usage = new Map<string, { current: number; previous: number }>();
    for (const row of [...sr, ...ap]) {
      const acc = usage.get(row.ownerId) ?? { current: 0, previous: 0 };
      acc.current += toInt(row.current);
      acc.previous += toInt(row.previous);
      usage.set(row.ownerId, acc);
    }
    const errorsMap = new Map(errors.map((r) => [r.ownerId, toInt(r.total)]));
    const deliveryMap = new Map(
      delivery.map((r) => [r.ownerId, toInt(r.total)]),
    );

    return [...latestSubs.values()].map((row) => {
      const q = quota.get(row.subscriptionId);
      const seen = lastSeenMap.get(row.ownerId);
      return {
        ownerId: row.ownerId,
        ownerCreatedAt: new Date(row.ownerCreatedAt),
        deactivated: row.deactivatedAt !== null,
        status: row.status,
        trialEndsAt: row.trialEndsAt ? new Date(row.trialEndsAt) : null,
        hasGatewaySubscription: !!row.gatewaySubscriptionId,
        pastDueSince: row.pastDueSince ? new Date(row.pastDueSince) : null,
        lastSeenAt: seen ? new Date(seen) : null,
        usageCurrent: usage.get(row.ownerId)?.current ?? 0,
        usagePrevious: usage.get(row.ownerId)?.previous ?? 0,
        quotaUsed: q?.used ?? null,
        quotaLimit: q?.limit ?? null,
        errors: errorsMap.get(row.ownerId) ?? 0,
        deliveryFailures: deliveryMap.get(row.ownerId) ?? 0,
      };
    });
  }

  private async currentQuota(
    subscriptionIds: string[],
    now: Date,
  ): Promise<Map<string, { used: number; limit: number }>> {
    const map = new Map<string, { used: number; limit: number }>();
    if (subscriptionIds.length === 0) return map;
    const rows = await this.repository.manager
      .createQueryBuilder(SubscriptionQuotaPeriod, 'q')
      .select('q.subscriptionId', 'subscriptionId')
      .addSelect('q.surgeryRequestsUsed', 'used')
      .addSelect('q.surgeryRequestsLimit', 'limit')
      .where('q.subscriptionId IN (:...subscriptionIds)', { subscriptionIds })
      .andWhere('q.periodStart <= :quotaNow AND q.periodEnd > :quotaNow', {
        quotaNow: now,
      })
      .getRawMany<{ subscriptionId: string; used: number; limit: number }>();
    for (const r of rows) {
      map.set(r.subscriptionId, { used: toInt(r.used), limit: toInt(r.limit) });
    }
    return map;
  }

  async upsertMany(rows: AccountHealthRowValues[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const tuples = rows.map((row, i) => {
      values.push(
        row.ownerId,
        row.day,
        row.score,
        row.band,
        JSON.stringify(row.factors),
        row.computedAt,
      );
      const base = i * UPSERT_COLUMNS;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6})`;
    });
    await this.repository.manager.query(
      `INSERT INTO "account_health_daily"
         ("owner_id", "day", "score", "band", "factors", "computed_at")
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("owner_id", "day") DO UPDATE SET
         "score" = EXCLUDED."score",
         "band" = EXCLUDED."band",
         "factors" = EXCLUDED."factors",
         "computed_at" = EXCLUDED."computed_at"`,
      values,
    );
  }

  async deleteDayExcept(day: string, ownerIds: string[]): Promise<void> {
    await this.repository.manager.query(
      `DELETE FROM "account_health_daily"
         WHERE "day" = $1 AND NOT ("owner_id" = ANY($2::uuid[]))`,
      [day, ownerIds],
    );
  }

  async latestComputedAt(): Promise<Date | null> {
    const raw = await this.repository
      .createQueryBuilder('h')
      .select('MAX(h.computedAt)', 'computedAt')
      .getRawOne<{ computedAt: Date | null }>();
    return raw?.computedAt ? new Date(raw.computedAt) : null;
  }

  async latestForOwners(
    ownerIds: string[],
  ): Promise<Map<string, AccountHealthDaily>> {
    const map = new Map<string, AccountHealthDaily>();
    if (ownerIds.length === 0) return map;
    const rows = await this.repository
      .createQueryBuilder('h')
      .where('h.ownerId IN (:...ownerIds)', { ownerIds })
      .andWhere(`h.day = ${LATEST_HEALTH_DAY_SQL}`)
      .getMany();
    for (const row of rows) map.set(row.ownerId, row);
    return map;
  }

  async history(
    ownerId: string,
    fromDay: string,
  ): Promise<AccountHealthHistoryPoint[]> {
    const rows = await this.repository
      .createQueryBuilder('h')
      .select(['h.day', 'h.score', 'h.band'])
      .where('h.ownerId = :ownerId', { ownerId })
      .andWhere('h.day >= :fromDay', { fromDay })
      .orderBy('h.day', 'ASC')
      .getMany();
    return rows.map((r) => ({ day: r.day, score: r.score, band: r.band }));
  }

  async countAtRisk(): Promise<number> {
    return this.repository
      .createQueryBuilder('h')
      .where(`h.day = ${LATEST_HEALTH_DAY_SQL}`)
      .andWhere("h.band = 'risk'")
      .getCount();
  }

  async topAtRisk(limit: number): Promise<AccountAtRiskRow[]> {
    const rows = await this.repository
      .createQueryBuilder('h')
      .innerJoin('h.owner', 'o')
      .select(['h.ownerId', 'h.score', 'h.factors', 'o.id', 'o.name'])
      .where(`h.day = ${LATEST_HEALTH_DAY_SQL}`)
      .andWhere("h.band = 'risk'")
      .orderBy('h.score', 'ASC')
      .addOrderBy('h.ownerId', 'ASC')
      .limit(limit)
      .getMany();
    return rows.map((r) => ({
      ownerId: r.ownerId,
      name: r.owner.name,
      score: r.score,
      factors: r.factors,
    }));
  }

  async purgeBefore(day: string): Promise<number> {
    const rows: Array<{ count: number }> = await this.repository.manager.query(
      `WITH removidas AS (
         DELETE FROM "account_health_daily" WHERE "day" < $1 RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM removidas`,
      [day],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
