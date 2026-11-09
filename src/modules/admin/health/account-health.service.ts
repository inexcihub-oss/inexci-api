import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AccountAtRiskRow,
  AccountHealthHistoryPoint,
  AccountHealthInputWindow,
  AccountHealthRepository,
  AccountHealthRowValues,
} from 'src/database/repositories/account-health.repository';
import {
  ADMIN_TIME_ZONE,
  formatSaoPauloDate,
} from '../accounts/admin-account-situation';
import { shiftDayKey } from '../metrics/metrics-formulas';
import {
  AccountHealthConfig,
  ACCOUNT_HEALTH_CONFIG,
} from './account-health.config';
import { AccountHealthResult, scoreAccount } from './account-health-score';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
export const ACCOUNT_HEALTH_FRESH_MS = 2 * MS_PER_HOUR;
export const ACCOUNT_HEALTH_HISTORY_DAYS = 30;
export const ACCOUNT_HEALTH_RETENTION_DAYS = 90;

@Injectable()
export class AccountHealthService {
  private readonly logger = new Logger(AccountHealthService.name);
  private refreshing: Promise<number> | null = null;
  private readonly config: AccountHealthConfig = ACCOUNT_HEALTH_CONFIG;

  constructor(private readonly repository: AccountHealthRepository) {}

  @Cron('15 * * * *', { timeZone: ADMIN_TIME_ZONE })
  async handleHourlySnapshot(): Promise<void> {
    try {
      const count = await this.refresh();
      this.logger.log(`[account-health] ${count} contas avaliadas`);
    } catch (err) {
      this.logger.error(
        `[account-health] falha ao calcular a saúde das contas: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  window(now: Date): AccountHealthInputWindow {
    const usageMs = this.config.usageDrop.windowDays * MS_PER_DAY;
    return {
      now,
      usageCurrentFrom: new Date(now.getTime() - usageMs),
      usagePreviousFrom: new Date(now.getTime() - 2 * usageMs),
      errorsFromDay: shiftDayKey(
        formatSaoPauloDate(now),
        -(this.config.errors.windowDays - 1),
      ),
      deliveryFrom: new Date(
        now.getTime() - this.config.deliveryFailures.windowHours * MS_PER_HOUR,
      ),
    };
  }

  async computeFor(
    ownerIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, AccountHealthResult | null>> {
    const inputs = await this.repository.loadInputs(this.window(now), ownerIds);
    return new Map(
      inputs.map((input) => [
        input.ownerId,
        scoreAccount(input, now, this.config),
      ]),
    );
  }

  async computeOne(
    ownerId: string,
    now: Date = new Date(),
  ): Promise<AccountHealthResult | null> {
    const results = await this.computeFor([ownerId], now);
    return results.get(ownerId) ?? null;
  }

  refresh(now: Date = new Date()): Promise<number> {
    if (!this.refreshing) {
      this.refreshing = this.runRefresh(now).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async runRefresh(now: Date): Promise<number> {
    const inputs = await this.repository.loadInputs(this.window(now));
    const day = formatSaoPauloDate(now);
    const rows: AccountHealthRowValues[] = [];
    for (const input of inputs) {
      const result = scoreAccount(input, now, this.config);
      if (!result) continue;
      rows.push({ ownerId: input.ownerId, day, computedAt: now, ...result });
    }
    await this.repository.upsertMany(rows);
    await this.repository.deleteDayExcept(
      day,
      rows.map((r) => r.ownerId),
    );
    await this.repository.purgeBefore(
      shiftDayKey(day, -ACCOUNT_HEALTH_RETENTION_DAYS),
    );
    return rows.length;
  }

  async ensureFresh(now: Date = new Date()): Promise<void> {
    try {
      const last = await this.repository.latestComputedAt();
      const stale =
        !last ||
        now.getTime() - last.getTime() > ACCOUNT_HEALTH_FRESH_MS ||
        formatSaoPauloDate(last) !== formatSaoPauloDate(now);
      if (stale) await this.refresh(now);
    } catch (err) {
      this.logger.warn(
        `[account-health] não foi possível atualizar a saúde: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  latestFor(ownerIds: string[]) {
    return this.repository.latestForOwners(ownerIds);
  }

  history(
    ownerId: string,
    now: Date = new Date(),
  ): Promise<AccountHealthHistoryPoint[]> {
    return this.repository.history(
      ownerId,
      shiftDayKey(formatSaoPauloDate(now), -(ACCOUNT_HEALTH_HISTORY_DAYS - 1)),
    );
  }

  async atRisk(
    limit: number,
  ): Promise<{ total: number; items: AccountAtRiskRow[] }> {
    const [total, items] = await Promise.all([
      this.repository.countAtRisk(),
      this.repository.topAtRisk(limit),
    ]);
    return { total, items };
  }
}
