import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PlatformErrorDailyRepository,
  PlatformErrorFilter,
  PlatformErrorFingerprintRow,
} from 'src/database/repositories/platform-error-daily.repository';
import { NotificationSendLogRepository } from 'src/database/repositories/notification-send-log.repository';
import { NotificationSendStatus } from 'src/database/entities/notification-send-log.entity';
import { formatSaoPauloDate } from '../accounts/admin-account-situation';
import { saoPauloDayRangeOf, shiftDayKey } from '../metrics/metrics-formulas';
import { buildExploreUrl } from './grafana-explore';
import { GrafanaLokiClient, LokiUnavailableError } from './grafana-loki.client';
import {
  AdminAccountErrorsDto,
  AdminErrorFingerprintDto,
  AdminErrorOccurrencesDto,
  AdminErrorOccurrencesQueryDto,
  AdminErrorsOverviewDto,
  AdminErrorsQueryDto,
  AdminErrorTotalsDto,
} from './dto/admin-errors.dto';

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;
const TOP_ACCOUNTS = 10;
const OCCURRENCES_LIMIT = 20;
const LOKI_REQUEST_IDS = 10;
const LOKI_LINES = 50;
const LOKI_MARGIN_MS = 10 * 60 * 1000;

@Injectable()
export class AdminErrorsService {
  constructor(
    private readonly errors: PlatformErrorDailyRepository,
    private readonly sendLogs: NotificationSendLogRepository,
    private readonly loki: GrafanaLokiClient,
    private readonly config: ConfigService,
  ) {}

  private filterOf(
    query: AdminErrorsQueryDto,
    now: Date,
    ownerId?: string,
  ): PlatformErrorFilter {
    const toDay = formatSaoPauloDate(now);
    const days = query.days ?? DEFAULT_DAYS;
    return {
      fromDay: shiftDayKey(toDay, -(days - 1)),
      toDay,
      source: query.source,
      ownerId,
    };
  }

  private exploreUrl(
    requestId: string | null,
    traceId: string | null,
    at: Date,
  ): string | null {
    return buildExploreUrl(
      {
        exploreUrl: this.config.get<string>('GRAFANA_EXPLORE_URL'),
        datasourceUid: this.config.get<string>('GRAFANA_LOKI_DATASOURCE_UID'),
        service: this.loki.service,
      },
      { requestId, traceId },
      new Date(at),
    );
  }

  private toFingerprintDto(
    row: PlatformErrorFingerprintRow,
  ): AdminErrorFingerprintDto {
    return {
      fingerprint: row.fingerprint,
      source: row.source,
      errorClass: row.errorClass,
      route: row.route,
      lastMessage: row.lastMessage,
      total: row.total,
      accounts: row.accounts,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      lastRequestId: row.lastRequestId,
      exploreUrl: this.exploreUrl(
        row.lastRequestId,
        row.lastTraceId,
        row.lastSeenAt,
      ),
    };
  }

  private async failedDeliveries(filter: PlatformErrorFilter): Promise<number> {
    if (filter.source && filter.source !== 'notification') return 0;
    const rows = await this.sendLogs.stats({
      status: NotificationSendStatus.FAILED,
      ownerId: filter.ownerId,
      from: saoPauloDayRangeOf(filter.fromDay).from,
      to: saoPauloDayRangeOf(filter.toDay).to,
    });
    return rows.reduce((sum, r) => sum + Number(r.count), 0);
  }

  private async totalsOf(
    filter: PlatformErrorFilter,
  ): Promise<AdminErrorTotalsDto> {
    const [totals, failedDeliveries] = await Promise.all([
      this.errors.totals(filter),
      this.failedDeliveries(filter),
    ]);
    return { ...totals, failedDeliveries };
  }

  async overview(
    query: AdminErrorsQueryDto,
    now: Date = new Date(),
  ): Promise<AdminErrorsOverviewDto> {
    const filter = this.filterOf(query, now);
    const [totals, daily, page, accounts] = await Promise.all([
      this.totalsOf(filter),
      this.errors.dailySeries(filter),
      this.errors.topFingerprints({
        ...filter,
        limit: query.limit ?? DEFAULT_LIMIT,
        offset: query.offset ?? 0,
      }),
      this.errors.topAccounts({ ...filter, limit: TOP_ACCOUNTS }),
    ]);
    return {
      fromDay: filter.fromDay,
      toDay: filter.toDay,
      totals,
      daily,
      fingerprints: {
        items: page.items.map((row) => this.toFingerprintDto(row)),
        total: page.total,
      },
      accounts,
      lokiAvailable: this.loki.isConfigured(),
    };
  }

  async forAccount(
    ownerId: string,
    query: AdminErrorsQueryDto,
    now: Date = new Date(),
  ): Promise<AdminAccountErrorsDto> {
    const filter = this.filterOf(query, now, ownerId);
    const [totals, daily, page] = await Promise.all([
      this.totalsOf(filter),
      this.errors.dailySeries(filter),
      this.errors.topFingerprints({
        ...filter,
        limit: query.limit ?? DEFAULT_LIMIT,
        offset: query.offset ?? 0,
      }),
    ]);
    return {
      ownerId,
      fromDay: filter.fromDay,
      toDay: filter.toDay,
      totals,
      daily,
      fingerprints: {
        items: page.items.map((row) => this.toFingerprintDto(row)),
        total: page.total,
      },
      lokiAvailable: this.loki.isConfigured(),
    };
  }

  async occurrences(
    fingerprint: string,
    query: AdminErrorOccurrencesQueryDto,
    now: Date = new Date(),
  ): Promise<AdminErrorOccurrencesDto> {
    const filter = this.filterOf(query, now, query.ownerId);
    const rows = await this.errors.occurrencesOf(fingerprint, {
      ...filter,
      limit: OCCURRENCES_LIMIT,
    });
    if (rows.length === 0) {
      throw new NotFoundException('Erro não encontrado no período');
    }
    const occurrences = rows.map((row) => ({
      day: row.day,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      count: row.count,
      lastSeenAt: row.lastSeenAt,
      lastRequestId: row.lastRequestId,
      lastMessage: row.lastMessage,
      route: row.route,
      exploreUrl: this.exploreUrl(
        row.lastRequestId,
        row.lastTraceId,
        row.lastSeenAt,
      ),
    }));

    if (!this.loki.isConfigured()) {
      return {
        fingerprint,
        occurrences,
        logs: [],
        lokiAvailable: false,
        lokiError: 'not_configured',
      };
    }

    const recent = rows
      .filter((row) => row.lastRequestId)
      .slice(0, LOKI_REQUEST_IDS);
    const times = recent.map((row) => new Date(row.lastSeenAt).getTime());
    try {
      const logs =
        recent.length === 0
          ? []
          : await this.loki.searchByRequestIds(
              recent.map((row) => row.lastRequestId as string),
              {
                from: new Date(Math.min(...times) - LOKI_MARGIN_MS),
                to: new Date(Math.max(...times) + LOKI_MARGIN_MS),
                limit: LOKI_LINES,
              },
            );
      return {
        fingerprint,
        occurrences,
        logs,
        lokiAvailable: true,
        lokiError: null,
      };
    } catch (err) {
      if (!(err instanceof LokiUnavailableError)) throw err;
      return {
        fingerprint,
        occurrences,
        logs: [],
        lokiAvailable: true,
        lokiError: 'unavailable',
      };
    }
  }
}
