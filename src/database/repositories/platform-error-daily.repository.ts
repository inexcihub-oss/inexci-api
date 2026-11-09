import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  PLATFORM_ERROR_DAILY_KEY,
  PlatformErrorDaily,
  PlatformErrorSource,
} from '../entities/platform-error-daily.entity';
import { User } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

export interface PlatformErrorRecord {
  ownerId: string | null;
  day: string;
  source: PlatformErrorSource;
  fingerprint: string;
  errorClass: string | null;
  route: string | null;
  occurredAt: Date;
  message: string | null;
  requestId: string | null;
  traceId: string | null;
  userId: string | null;
}

export interface PlatformErrorFilter {
  fromDay: string;
  toDay: string;
  source?: PlatformErrorSource;
  ownerId?: string;
}

export interface PlatformErrorFingerprintRow {
  fingerprint: string;
  source: PlatformErrorSource;
  errorClass: string | null;
  route: string | null;
  lastMessage: string | null;
  total: number;
  accounts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastRequestId: string | null;
  lastTraceId: string | null;
}

export interface PlatformErrorAccountRow {
  ownerId: string;
  ownerName: string | null;
  total: number;
  fingerprints: number;
  lastSeenAt: Date;
}

export interface PlatformErrorDayRow {
  day: string;
  source: PlatformErrorSource;
  total: number;
}

export interface PlatformErrorOccurrenceRow {
  day: string;
  ownerId: string | null;
  ownerName: string | null;
  count: number;
  lastSeenAt: Date;
  lastRequestId: string | null;
  lastTraceId: string | null;
  lastMessage: string | null;
  route: string | null;
}

export interface PlatformErrorSpikeRow {
  ownerId: string;
  ownerName: string | null;
  total: number;
}

const UPSERT_SQL = `
  INSERT INTO "platform_error_daily" (
    "owner_id", "day", "source", "fingerprint", "error_class", "sample_route",
    "count", "first_seen_at", "last_seen_at", "last_message",
    "last_request_id", "last_trace_id", "last_user_id"
  )
  VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7, $8, $9, $10, $11)
  ON CONFLICT ON CONSTRAINT "${PLATFORM_ERROR_DAILY_KEY}" DO UPDATE SET
    "count" = "platform_error_daily"."count" + 1,
    "first_seen_at" = LEAST("platform_error_daily"."first_seen_at", EXCLUDED."first_seen_at"),
    "last_seen_at" = GREATEST("platform_error_daily"."last_seen_at", EXCLUDED."last_seen_at"),
    "error_class" = EXCLUDED."error_class",
    "sample_route" = EXCLUDED."sample_route",
    "last_message" = EXCLUDED."last_message",
    "last_request_id" = EXCLUDED."last_request_id",
    "last_trace_id" = EXCLUDED."last_trace_id",
    "last_user_id" = EXCLUDED."last_user_id"
`;

function latest(column: string): string {
  return `(array_agg(e.${column} ORDER BY e.last_seen_at DESC))[1]`;
}

@Injectable()
export class PlatformErrorDailyRepository extends BaseRepository<PlatformErrorDaily> {
  constructor(
    @InjectRepository(PlatformErrorDaily)
    repository: Repository<PlatformErrorDaily>,
  ) {
    super(repository);
  }

  async increment(record: PlatformErrorRecord): Promise<void> {
    await this.repository.manager.query(UPSERT_SQL, [
      record.ownerId,
      record.day,
      record.source,
      record.fingerprint,
      record.errorClass,
      record.route,
      record.occurredAt,
      record.message,
      record.requestId,
      record.traceId,
      record.userId,
    ]);
  }

  private applyFilter(
    qb: SelectQueryBuilder<PlatformErrorDaily>,
    filter: PlatformErrorFilter,
  ): void {
    qb.where('e.day >= :fromDay AND e.day <= :toDay', {
      fromDay: filter.fromDay,
      toDay: filter.toDay,
    });
    if (filter.source) {
      qb.andWhere('e.source = :source', { source: filter.source });
    }
    if (filter.ownerId) {
      qb.andWhere('e.owner_id = :ownerId', { ownerId: filter.ownerId });
    }
  }

  async totals(
    filter: PlatformErrorFilter,
  ): Promise<{ total: number; accounts: number; fingerprints: number }> {
    const qb = this.repository
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.count), 0)::int', 'total')
      .addSelect('COUNT(DISTINCT e.owner_id)::int', 'accounts')
      .addSelect('COUNT(DISTINCT e.fingerprint)::int', 'fingerprints');
    this.applyFilter(qb, filter);
    const row = await qb.getRawOne<{
      total: number;
      accounts: number;
      fingerprints: number;
    }>();
    return {
      total: Number(row?.total ?? 0),
      accounts: Number(row?.accounts ?? 0),
      fingerprints: Number(row?.fingerprints ?? 0),
    };
  }

  async topFingerprints(
    filter: PlatformErrorFilter & { limit: number; offset: number },
  ): Promise<{ items: PlatformErrorFingerprintRow[]; total: number }> {
    const countQb = this.repository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.fingerprint)::int', 'total');
    this.applyFilter(countQb, filter);
    const counted = await countQb.getRawOne<{ total: number }>();

    const qb = this.repository
      .createQueryBuilder('e')
      .select('e.fingerprint', 'fingerprint')
      .addSelect('e.source', 'source')
      .addSelect(latest('error_class'), 'errorClass')
      .addSelect(latest('sample_route'), 'route')
      .addSelect(latest('last_message'), 'lastMessage')
      .addSelect(latest('last_request_id'), 'lastRequestId')
      .addSelect(latest('last_trace_id'), 'lastTraceId')
      .addSelect('SUM(e.count)::int', 'total')
      .addSelect('COUNT(DISTINCT e.owner_id)::int', 'accounts')
      .addSelect('MIN(e.first_seen_at)', 'firstSeenAt')
      .addSelect('MAX(e.last_seen_at)', 'lastSeenAt');
    this.applyFilter(qb, filter);
    const items = await qb
      .groupBy('e.fingerprint')
      .addGroupBy('e.source')
      .orderBy('"total"', 'DESC')
      .addOrderBy('"lastSeenAt"', 'DESC')
      .offset(filter.offset)
      .limit(filter.limit)
      .getRawMany<PlatformErrorFingerprintRow>();

    return {
      items: items.map((r) => ({
        ...r,
        total: Number(r.total),
        accounts: Number(r.accounts),
      })),
      total: Number(counted?.total ?? 0),
    };
  }

  async topAccounts(
    filter: PlatformErrorFilter & { limit: number },
  ): Promise<PlatformErrorAccountRow[]> {
    const qb = this.repository
      .createQueryBuilder('e')
      .leftJoin(User, 'o', 'o.id = e.owner_id')
      .select('e.owner_id', 'ownerId')
      .addSelect('o.name', 'ownerName')
      .addSelect('SUM(e.count)::int', 'total')
      .addSelect('COUNT(DISTINCT e.fingerprint)::int', 'fingerprints')
      .addSelect('MAX(e.last_seen_at)', 'lastSeenAt');
    this.applyFilter(qb, filter);
    const rows = await qb
      .andWhere('e.owner_id IS NOT NULL')
      .groupBy('e.owner_id')
      .addGroupBy('o.name')
      .orderBy('"total"', 'DESC')
      .limit(filter.limit)
      .getRawMany<PlatformErrorAccountRow>();
    return rows.map((r) => ({
      ...r,
      total: Number(r.total),
      fingerprints: Number(r.fingerprints),
    }));
  }

  async dailySeries(
    filter: PlatformErrorFilter,
  ): Promise<PlatformErrorDayRow[]> {
    const qb = this.repository
      .createQueryBuilder('e')
      .select(`to_char(e.day, 'YYYY-MM-DD')`, 'day')
      .addSelect('e.source', 'source')
      .addSelect('SUM(e.count)::int', 'total');
    this.applyFilter(qb, filter);
    const rows = await qb
      .groupBy('e.day')
      .addGroupBy('e.source')
      .orderBy('e.day', 'ASC')
      .getRawMany<PlatformErrorDayRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async occurrencesOf(
    fingerprint: string,
    filter: PlatformErrorFilter & { limit: number },
  ): Promise<PlatformErrorOccurrenceRow[]> {
    const qb = this.repository
      .createQueryBuilder('e')
      .leftJoin(User, 'o', 'o.id = e.owner_id')
      .select(`to_char(e.day, 'YYYY-MM-DD')`, 'day')
      .addSelect('e.owner_id', 'ownerId')
      .addSelect('o.name', 'ownerName')
      .addSelect('e.count', 'count')
      .addSelect('e.last_seen_at', 'lastSeenAt')
      .addSelect('e.last_request_id', 'lastRequestId')
      .addSelect('e.last_trace_id', 'lastTraceId')
      .addSelect('e.last_message', 'lastMessage')
      .addSelect('e.sample_route', 'route');
    this.applyFilter(qb, filter);
    const rows = await qb
      .andWhere('e.fingerprint = :fingerprint', { fingerprint })
      .orderBy('e.last_seen_at', 'DESC')
      .limit(filter.limit)
      .getRawMany<PlatformErrorOccurrenceRow>();
    return rows.map((r) => ({ ...r, count: Number(r.count) }));
  }

  async accountsWithSpike(
    since: Date,
    fromDay: string,
    threshold: number,
    limit: number,
  ): Promise<{ accounts: number; top: PlatformErrorSpikeRow[] }> {
    const rows = await this.repository
      .createQueryBuilder('e')
      .leftJoin(User, 'o', 'o.id = e.owner_id')
      .select('e.owner_id', 'ownerId')
      .addSelect('o.name', 'ownerName')
      .addSelect('SUM(e.count)::int', 'total')
      .where('e.day >= :fromDay', { fromDay })
      .andWhere('e.last_seen_at >= :since', { since })
      .andWhere('e.owner_id IS NOT NULL')
      .groupBy('e.owner_id')
      .addGroupBy('o.name')
      .having('SUM(e.count) >= :threshold', { threshold })
      .orderBy('"total"', 'DESC')
      .getRawMany<PlatformErrorSpikeRow>();
    const parsed = rows.map((r) => ({ ...r, total: Number(r.total) }));
    return { accounts: parsed.length, top: parsed.slice(0, limit) };
  }

  async purgeBefore(day: string): Promise<number> {
    const rows: Array<{ count: number }> = await this.repository.manager.query(
      `WITH removidas AS (
         DELETE FROM "platform_error_daily" WHERE "day" < $1 RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM removidas`,
      [day],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
