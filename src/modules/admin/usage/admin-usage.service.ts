import { Injectable } from '@nestjs/common';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AppointmentStatus,
} from 'src/database/entities/appointment.entity';
import { AdminAccountsRepository } from 'src/database/repositories/admin-accounts.repository';
import {
  AdminUsageRepository,
  AdminUsageWeekRow,
} from 'src/database/repositories/admin-usage.repository';
import {
  computeAccountSituation,
  formatSaoPauloDate,
  saoPauloWeekStart,
} from '../accounts/admin-account-situation';
import {
  AdminInactiveAccountsResponseDto,
  AdminUsageResponseDto,
  AdminUsageTotalsDto,
  AdminUsageWeekDto,
} from './dto/admin-usage-response.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PERIOD_DAYS = 30;
const RANKING_SIZE = 10;
const INACTIVE_LIMIT = 200;

function emptyTotals(): AdminUsageTotalsDto {
  return {
    surgeryRequestsCreated: 0,
    surgeryRequestsSent: 0,
    appointments: { scheduled: 0, completed: 0, cancelled: 0, noShow: 0 },
    patientsCreated: 0,
    recordsFinalized: 0,
  };
}

function byWeek(rows: AdminUsageWeekRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.weekStart, r.count]));
}

@Injectable()
export class AdminUsageService {
  constructor(
    private readonly usage: AdminUsageRepository,
    private readonly accounts: AdminAccountsRepository,
  ) {}

  async getUsage(
    query: { from?: Date; to?: Date },
    now: Date = new Date(),
  ): Promise<AdminUsageResponseDto> {
    const to = query.to ?? now;
    const from =
      query.from ?? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * MS_PER_DAY);
    const range = { from, to };

    const [
      created,
      sent,
      appointments,
      patients,
      records,
      active7,
      active30,
      totalClients,
      topBySurgeryRequests,
      topByAppointments,
    ] = await Promise.all([
      this.usage.weeklySurgeryRequestsCreated(range),
      this.usage.weeklySurgeryRequestsSent(range),
      this.usage.weeklyAppointmentsByStatus(range),
      this.usage.weeklyPatientsCreated(range),
      this.usage.weeklyRecordsFinalized(range),
      this.accounts.countClientsSeenSince(
        new Date(now.getTime() - 7 * MS_PER_DAY),
      ),
      this.accounts.countClientsSeenSince(
        new Date(now.getTime() - 30 * MS_PER_DAY),
      ),
      this.accounts.countClients(),
      this.usage.topBySurgeryRequests(range, RANKING_SIZE),
      this.usage.topByAppointments(range, RANKING_SIZE),
    ]);

    const createdByWeek = byWeek(created);
    const sentByWeek = byWeek(sent);
    const patientsByWeek = byWeek(patients);
    const recordsByWeek = byWeek(records);

    const weekly: AdminUsageWeekDto[] = [];
    const totals = emptyTotals();
    for (
      let cursor = saoPauloWeekStart(from);
      cursor.getTime() < to.getTime();
      cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
    ) {
      const weekStart = formatSaoPauloDate(cursor);
      const point: AdminUsageWeekDto = { ...emptyTotals(), weekStart };
      point.surgeryRequestsCreated = createdByWeek.get(weekStart) ?? 0;
      point.surgeryRequestsSent = sentByWeek.get(weekStart) ?? 0;
      point.patientsCreated = patientsByWeek.get(weekStart) ?? 0;
      point.recordsFinalized = recordsByWeek.get(weekStart) ?? 0;
      for (const row of appointments) {
        if (row.weekStart !== weekStart) continue;
        if (ACTIVE_APPOINTMENT_STATUSES.includes(row.status)) {
          point.appointments.scheduled += row.count;
        } else if (row.status === AppointmentStatus.COMPLETED) {
          point.appointments.completed += row.count;
        } else if (row.status === AppointmentStatus.CANCELLED) {
          point.appointments.cancelled += row.count;
        } else if (row.status === AppointmentStatus.NO_SHOW) {
          point.appointments.noShow += row.count;
        }
      }
      weekly.push(point);
      totals.surgeryRequestsCreated += point.surgeryRequestsCreated;
      totals.surgeryRequestsSent += point.surgeryRequestsSent;
      totals.patientsCreated += point.patientsCreated;
      totals.recordsFinalized += point.recordsFinalized;
      totals.appointments.scheduled += point.appointments.scheduled;
      totals.appointments.completed += point.appointments.completed;
      totals.appointments.cancelled += point.appointments.cancelled;
      totals.appointments.noShow += point.appointments.noShow;
    }

    return {
      from,
      to,
      totals,
      weekly,
      activeAccounts: {
        last7Days: active7,
        last30Days: active30,
        totalClients,
      },
      topBySurgeryRequests,
      topByAppointments,
    };
  }

  async getInactive(
    days: number,
    now: Date = new Date(),
  ): Promise<AdminInactiveAccountsResponseDto> {
    const page = await this.accounts.findInactiveClients(
      days,
      now,
      INACTIVE_LIMIT,
    );
    const metrics = await this.accounts.loadMetrics(
      page.items.map((i) => i.subscription.ownerId),
      [],
      { from: now, to: now },
      now,
    );
    return {
      days,
      total: page.total,
      items: page.items.map((row) => {
        const sub = row.subscription;
        const situation = computeAccountSituation(sub, now);
        const lastSeenAt = metrics.lastSeen.get(sub.ownerId) ?? null;
        return {
          ownerId: sub.ownerId,
          name: row.ownerName,
          email: row.ownerEmail,
          plan: {
            id: sub.plan.id,
            name: sub.plan.name,
            priceCents: sub.plan.priceCents,
            billingPeriod: sub.plan.billingPeriod,
          },
          situation: situation.situation,
          daysLeft: situation.daysLeft,
          daysOverdue: situation.daysOverdue,
          lastSeenAt,
          daysSinceLastSeen: lastSeenAt
            ? Math.floor((now.getTime() - lastSeenAt.getTime()) / MS_PER_DAY)
            : null,
        };
      }),
    };
  }
}
