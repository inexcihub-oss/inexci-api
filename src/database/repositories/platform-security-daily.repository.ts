import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  PLATFORM_SECURITY_DAILY_KEY,
  PlatformSecurityDaily,
  PlatformSecurityEventType,
} from '../entities/platform-security-daily.entity';
import { User, UserStatus } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

export interface PlatformSecurityRecord {
  ownerId: string | null;
  userId: string | null;
  day: string;
  eventType: PlatformSecurityEventType;
  occurredAt: Date;
  requestId: string | null;
}

export interface PlatformSecurityFilter {
  fromDay: string;
  toDay: string;
  ownerId?: string;
  eventTypes?: PlatformSecurityEventType[];
}

export interface SecurityIdentity {
  userId: string;
  ownerId: string | null;
}

export interface SecurityTotalRow {
  eventType: PlatformSecurityEventType;
  total: number;
}

export interface SecurityDayRow {
  day: string;
  eventType: PlatformSecurityEventType;
  total: number;
}

export interface SecurityAccountRow {
  ownerId: string;
  ownerName: string | null;
  total: number;
  users: number;
  lastSeenAt: Date;
}

export interface SecurityUserRow {
  userId: string;
  userName: string | null;
  eventType: PlatformSecurityEventType;
  total: number;
  lastSeenAt: Date;
  lastRequestId: string | null;
}

export interface MfaCoverage {
  activeUsers: number;
  withoutMfa: number;
}

const UPSERT_SQL = `
  INSERT INTO "platform_security_daily" (
    "owner_id", "user_id", "day", "event_type", "count",
    "first_seen_at", "last_seen_at", "last_request_id"
  )
  VALUES ($1, $2, $3, $4, 1, $5, $5, $6)
  ON CONFLICT ON CONSTRAINT "${PLATFORM_SECURITY_DAILY_KEY}" DO UPDATE SET
    "count" = "platform_security_daily"."count" + 1,
    "first_seen_at" = LEAST("platform_security_daily"."first_seen_at", EXCLUDED."first_seen_at"),
    "last_seen_at" = GREATEST("platform_security_daily"."last_seen_at", EXCLUDED."last_seen_at"),
    "last_request_id" = COALESCE(EXCLUDED."last_request_id", "platform_security_daily"."last_request_id")
`;

@Injectable()
export class PlatformSecurityDailyRepository extends BaseRepository<PlatformSecurityDaily> {
  constructor(
    @InjectRepository(PlatformSecurityDaily)
    repository: Repository<PlatformSecurityDaily>,
  ) {
    super(repository);
  }

  async increment(record: PlatformSecurityRecord): Promise<void> {
    await this.repository.manager.query(UPSERT_SQL, [
      record.ownerId,
      record.userId,
      record.day,
      record.eventType,
      record.occurredAt,
      record.requestId,
    ]);
  }

  async identityById(userId: string): Promise<SecurityIdentity | null> {
    const row = await this.repository.manager
      .createQueryBuilder(User, 'u')
      .withDeleted()
      .select('u.id', 'userId')
      .addSelect('u.owner_id', 'ownerId')
      .where('u.id = :userId', { userId })
      .getRawOne<SecurityIdentity>();
    return row ?? null;
  }

  async identityByEmail(email: string): Promise<SecurityIdentity | null> {
    const row = await this.repository.manager
      .createQueryBuilder(User, 'u')
      .select('u.id', 'userId')
      .addSelect('u.owner_id', 'ownerId')
      .where('lower(u.email) = lower(:email)', { email })
      .getRawOne<SecurityIdentity>();
    return row ?? null;
  }

  private applyFilter(
    qb: SelectQueryBuilder<PlatformSecurityDaily>,
    filter: PlatformSecurityFilter,
  ): void {
    qb.where('s.day >= :fromDay AND s.day <= :toDay', {
      fromDay: filter.fromDay,
      toDay: filter.toDay,
    });
    if (filter.ownerId) {
      qb.andWhere('s.owner_id = :ownerId', { ownerId: filter.ownerId });
    }
    if (filter.eventTypes?.length) {
      qb.andWhere('s.event_type IN (:...eventTypes)', {
        eventTypes: filter.eventTypes,
      });
    }
  }

  async totalsByType(
    filter: PlatformSecurityFilter,
  ): Promise<SecurityTotalRow[]> {
    const qb = this.repository
      .createQueryBuilder('s')
      .select('s.event_type', 'eventType')
      .addSelect('SUM(s.count)::int', 'total');
    this.applyFilter(qb, filter);
    const rows = await qb
      .groupBy('s.event_type')
      .getRawMany<SecurityTotalRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async unattributedTotal(filter: PlatformSecurityFilter): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.count), 0)::int', 'total');
    this.applyFilter(qb, filter);
    const row = await qb
      .andWhere('s.owner_id IS NULL')
      .getRawOne<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async dailySeries(filter: PlatformSecurityFilter): Promise<SecurityDayRow[]> {
    const qb = this.repository
      .createQueryBuilder('s')
      .select(`to_char(s.day, 'YYYY-MM-DD')`, 'day')
      .addSelect('s.event_type', 'eventType')
      .addSelect('SUM(s.count)::int', 'total');
    this.applyFilter(qb, filter);
    const rows = await qb
      .groupBy('s.day')
      .addGroupBy('s.event_type')
      .orderBy('s.day', 'ASC')
      .getRawMany<SecurityDayRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async topAccounts(
    filter: PlatformSecurityFilter & { limit: number },
  ): Promise<SecurityAccountRow[]> {
    const qb = this.repository
      .createQueryBuilder('s')
      .leftJoin(User, 'o', 'o.id = s.owner_id')
      .select('s.owner_id', 'ownerId')
      .addSelect('o.name', 'ownerName')
      .addSelect('SUM(s.count)::int', 'total')
      .addSelect('COUNT(DISTINCT s.user_id)::int', 'users')
      .addSelect('MAX(s.last_seen_at)', 'lastSeenAt');
    this.applyFilter(qb, filter);
    const rows = await qb
      .andWhere('s.owner_id IS NOT NULL')
      .groupBy('s.owner_id')
      .addGroupBy('o.name')
      .orderBy('"total"', 'DESC')
      .addOrderBy('"lastSeenAt"', 'DESC')
      .limit(filter.limit)
      .getRawMany<SecurityAccountRow>();
    return rows.map((r) => ({
      ...r,
      total: Number(r.total),
      users: Number(r.users),
    }));
  }

  async byUser(filter: PlatformSecurityFilter): Promise<SecurityUserRow[]> {
    const qb = this.repository
      .createQueryBuilder('s')
      .leftJoin(User, 'u', 'u.id = s.user_id')
      .select('s.user_id', 'userId')
      .addSelect('u.name', 'userName')
      .addSelect('s.event_type', 'eventType')
      .addSelect('SUM(s.count)::int', 'total')
      .addSelect('MAX(s.last_seen_at)', 'lastSeenAt')
      .addSelect(
        '(array_agg(s.last_request_id ORDER BY s.last_seen_at DESC))[1]',
        'lastRequestId',
      );
    this.applyFilter(qb, filter);
    const rows = await qb
      .andWhere('s.user_id IS NOT NULL')
      .groupBy('s.user_id')
      .addGroupBy('u.name')
      .addGroupBy('s.event_type')
      .orderBy('"lastSeenAt"', 'DESC')
      .getRawMany<SecurityUserRow>();
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  async loginFailuresSince(
    since: Date,
    fromDay: string,
  ): Promise<{ total: number; accounts: SecurityAccountRow[] }> {
    const types: PlatformSecurityEventType[] = [
      'login_failed',
      'login_locked',
      'mfa_failed',
    ];
    const base = () =>
      this.repository
        .createQueryBuilder('s')
        .where('s.day >= :fromDay', { fromDay })
        .andWhere('s.last_seen_at >= :since', { since })
        .andWhere('s.event_type IN (:...types)', { types });
    const totalRow = await base()
      .select('COALESCE(SUM(s.count), 0)::int', 'total')
      .getRawOne<{ total: number }>();
    const rows = await base()
      .leftJoin(User, 'o', 'o.id = s.owner_id')
      .select('s.owner_id', 'ownerId')
      .addSelect('o.name', 'ownerName')
      .addSelect('SUM(s.count)::int', 'total')
      .addSelect('COUNT(DISTINCT s.user_id)::int', 'users')
      .addSelect('MAX(s.last_seen_at)', 'lastSeenAt')
      .andWhere('s.owner_id IS NOT NULL')
      .groupBy('s.owner_id')
      .addGroupBy('o.name')
      .orderBy('"total"', 'DESC')
      .getRawMany<SecurityAccountRow>();
    return {
      total: Number(totalRow?.total ?? 0),
      accounts: rows.map((r) => ({
        ...r,
        total: Number(r.total),
        users: Number(r.users),
      })),
    };
  }

  async mfaCoverage(ownerId?: string): Promise<MfaCoverage> {
    const qb = this.repository.manager
      .createQueryBuilder(User, 'u')
      .select('COUNT(*)::int', 'activeUsers')
      .addSelect(
        'COUNT(*) FILTER (WHERE u.mfa_enabled_at IS NULL)::int',
        'withoutMfa',
      )
      .where('u.status = :status', { status: UserStatus.ACTIVE });
    if (ownerId) qb.andWhere('u.owner_id = :ownerId', { ownerId });
    const row = await qb.getRawOne<MfaCoverage>();
    return {
      activeUsers: Number(row?.activeUsers ?? 0),
      withoutMfa: Number(row?.withoutMfa ?? 0),
    };
  }

  async purgeBefore(day: string): Promise<number> {
    const rows: Array<{ count: number }> = await this.repository.manager.query(
      `WITH removidas AS (
         DELETE FROM "platform_security_daily" WHERE "day" < $1 RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM removidas`,
      [day],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
