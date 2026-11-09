import { Injectable } from '@nestjs/common';
import {
  PLATFORM_SECURITY_EVENTS,
  PlatformSecurityEventType,
} from 'src/database/entities/platform-security-daily.entity';
import {
  PlatformSecurityDailyRepository,
  PlatformSecurityFilter,
  SecurityTotalRow,
  SecurityUserRow,
} from 'src/database/repositories/platform-security-daily.repository';
import { maskIpAddresses } from 'src/shared/utils/mask.util';
import { formatSaoPauloDate } from '../accounts/admin-account-situation';
import {
  GrafanaLokiClient,
  LokiUnavailableError,
} from '../errors/grafana-loki.client';
import { saoPauloDayRangeOf, shiftDayKey } from '../metrics/metrics-formulas';
import {
  AdminAccountSecurityDto,
  AdminAccountSecurityLogsDto,
  AdminSecurityOverviewDto,
  AdminSecurityQueryDto,
  AdminSecuritySpikeDto,
  AdminSecurityTotalsDto,
  AdminSecurityUserDto,
} from './dto/admin-security.dto';
import {
  FAILURE_EVENTS,
  LOGIN_FAILURE_SPIKE_PER_ACCOUNT,
  LOGIN_FAILURE_SPIKE_PLATFORM,
  SECURITY_LOG_LINES,
  SECURITY_LOG_MARKER,
  SECURITY_LOG_USERS,
  SECURITY_SPIKE_TOP,
  SECURITY_TOP_ACCOUNTS,
  SESSION_REVOKING_EVENTS,
} from './security.config';

const DEFAULT_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function emptySecurityTotals(): AdminSecurityTotalsDto {
  return Object.fromEntries(
    PLATFORM_SECURITY_EVENTS.map((type) => [type, 0]),
  ) as unknown as AdminSecurityTotalsDto;
}

export function toSecurityTotals(
  rows: Array<Pick<SecurityTotalRow, 'eventType' | 'total'>>,
): AdminSecurityTotalsDto {
  const totals = emptySecurityTotals();
  for (const row of rows) {
    if (row.eventType in totals) {
      totals[row.eventType] += row.total;
    }
  }
  return totals;
}

function sumOf(
  totals: AdminSecurityTotalsDto,
  types: PlatformSecurityEventType[],
): number {
  return types.reduce((sum, type) => sum + totals[type], 0);
}

export function groupSecurityByUser(
  rows: SecurityUserRow[],
): AdminSecurityUserDto[] {
  const byUser = new Map<string, AdminSecurityUserDto>();
  for (const row of rows) {
    const current = byUser.get(row.userId) ?? {
      userId: row.userId,
      userName: row.userName,
      events: emptySecurityTotals(),
      failures: 0,
      sessionsRevoked: 0,
      lastSeenAt: row.lastSeenAt,
    };
    current.events[row.eventType] += row.total;
    if (new Date(row.lastSeenAt) > new Date(current.lastSeenAt)) {
      current.lastSeenAt = row.lastSeenAt;
    }
    byUser.set(row.userId, current);
  }
  return [...byUser.values()]
    .map((user) => ({
      ...user,
      failures: sumOf(user.events, FAILURE_EVENTS),
      sessionsRevoked: sumOf(user.events, SESSION_REVOKING_EVENTS),
    }))
    .sort(
      (a, b) =>
        b.failures + b.sessionsRevoked - (a.failures + a.sessionsRevoked) ||
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
    );
}

@Injectable()
export class AdminSecurityService {
  constructor(
    private readonly security: PlatformSecurityDailyRepository,
    private readonly loki: GrafanaLokiClient,
  ) {}

  private filterOf(
    query: AdminSecurityQueryDto,
    now: Date,
    ownerId?: string,
  ): PlatformSecurityFilter {
    const toDay = formatSaoPauloDate(now);
    const days = query.days ?? DEFAULT_DAYS;
    return { fromDay: shiftDayKey(toDay, -(days - 1)), toDay, ownerId };
  }

  async spike(now: Date = new Date()): Promise<AdminSecuritySpikeDto> {
    const result = await this.security.loginFailuresSince(
      new Date(now.getTime() - MS_PER_DAY),
      shiftDayKey(formatSaoPauloDate(now), -1),
    );
    const above = result.accounts.filter(
      (row) => row.total >= LOGIN_FAILURE_SPIKE_PER_ACCOUNT,
    );
    return {
      accountThreshold: LOGIN_FAILURE_SPIKE_PER_ACCOUNT,
      platformThreshold: LOGIN_FAILURE_SPIKE_PLATFORM,
      platformTotal24h: result.total,
      platformSpike: result.total >= LOGIN_FAILURE_SPIKE_PLATFORM,
      accountsWithSpike24h: above.length,
      topSpikeAccounts: above.slice(0, SECURITY_SPIKE_TOP),
    };
  }

  async overview(
    query: AdminSecurityQueryDto,
    now: Date = new Date(),
  ): Promise<AdminSecurityOverviewDto> {
    const filter = this.filterOf(query, now);
    const [
      totals,
      unattributedLocks,
      daily,
      failureAccounts,
      reuseAccounts,
      mfa,
      spike,
    ] = await Promise.all([
      this.security.totalsByType(filter),
      this.security.unattributedTotal({
        ...filter,
        eventTypes: ['login_locked'],
      }),
      this.security.dailySeries(filter),
      this.security.topAccounts({
        ...filter,
        eventTypes: FAILURE_EVENTS,
        limit: SECURITY_TOP_ACCOUNTS,
      }),
      this.security.topAccounts({
        ...filter,
        eventTypes: ['refresh_reuse'],
        limit: SECURITY_TOP_ACCOUNTS,
      }),
      this.security.mfaCoverage(),
      this.spike(now),
    ]);
    return {
      fromDay: filter.fromDay,
      toDay: filter.toDay,
      totals: toSecurityTotals(totals),
      unattributedLocks,
      daily,
      failureAccounts,
      reuseAccounts,
      mfa,
      spike,
      lokiAvailable: this.loki.isConfigured(),
    };
  }

  async forAccount(
    ownerId: string,
    query: AdminSecurityQueryDto,
    now: Date = new Date(),
  ): Promise<AdminAccountSecurityDto> {
    const filter = this.filterOf(query, now, ownerId);
    const [totals, daily, users, mfa] = await Promise.all([
      this.security.totalsByType(filter),
      this.security.dailySeries(filter),
      this.security.byUser(filter),
      this.security.mfaCoverage(ownerId),
    ]);
    return {
      ownerId,
      fromDay: filter.fromDay,
      toDay: filter.toDay,
      totals: toSecurityTotals(totals),
      daily,
      users: groupSecurityByUser(users),
      mfa,
      lokiAvailable: this.loki.isConfigured(),
    };
  }

  async logsForAccount(
    ownerId: string,
    query: AdminSecurityQueryDto,
    now: Date = new Date(),
  ): Promise<AdminAccountSecurityLogsDto> {
    if (!this.loki.isConfigured()) {
      return { logs: [], lokiAvailable: false, lokiError: 'not_configured' };
    }
    const filter = this.filterOf(query, now, ownerId);
    const users = groupSecurityByUser(await this.security.byUser(filter));
    const userIds = users
      .slice(0, SECURITY_LOG_USERS)
      .map((user) => user.userId);
    if (userIds.length === 0) {
      return { logs: [], lokiAvailable: true, lokiError: null };
    }
    try {
      const lines = await this.loki.searchUserEvents(
        userIds,
        SECURITY_LOG_MARKER,
        {
          from: saoPauloDayRangeOf(filter.fromDay).from,
          to: now,
          limit: SECURITY_LOG_LINES,
        },
      );
      return {
        logs: lines.map((line) => ({
          timestamp: line.timestamp,
          level: line.level,
          message: maskIpAddresses(line.message),
          requestId: line.requestId,
        })),
        lokiAvailable: true,
        lokiError: null,
      };
    } catch (err) {
      if (!(err instanceof LokiUnavailableError)) throw err;
      return { logs: [], lokiAvailable: true, lokiError: 'unavailable' };
    }
  }
}
