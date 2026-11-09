import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { User, UserStatus } from 'src/database/entities/user.entity';
import {
  AdminActivationRepository,
  MemberUsageRow,
} from 'src/database/repositories/admin-activation.repository';
import { maskPhone } from 'src/shared/utils/mask.util';
import { memberOnboarding } from '../activation/activation-summary';
import { AdminTeamPeriodDays } from './dto/admin-team-query.dto';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import {
  AdminAccountSituationKey,
  AdminAccountsFilter,
  AdminAccountsMetrics,
  AdminAccountSubscriptionRow,
  AdminAccountsRepository,
} from 'src/database/repositories/admin-accounts.repository';
import { PAYMENT_GATEWAY, PaymentGateway } from 'src/shared/payment-gateway';
import { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';
import {
  deactivationBlock,
  internalAccessBlock,
  trialExtensionDecision,
  uniqueGatewaySubscriptions,
} from '../subscriptions/subscription-admin-rules';
import { permissionsOf } from 'src/shared/permissions';
import { AccountHealthService } from '../health/account-health.service';
import { AccountHealthResult } from '../health/account-health-score';
import {
  AccountHealthBand,
  AccountHealthFactor,
} from 'src/database/entities/account-health-daily.entity';
import {
  AdminAccountSituation,
  computeAccountSituation,
  computeMonthlyAmountCents,
  formatSaoPauloDate,
  saoPauloMonthRange,
  saoPauloWeekStart,
} from './admin-account-situation';
import {
  AdminAccountCountsDto,
  AdminAccountDetailDto,
  AdminAccountGatewayDto,
  AdminAccountHealthDetailDto,
  AdminAccountHealthSummaryDto,
  AdminAccountItemDto,
  AdminAccountListResponseDto,
  AdminAccountSubscriptionDto,
  AdminAccountUsageDto,
  AdminTeamMemberDto,
  AdminTeamMemberStatus,
  AdminTeamResponseDto,
  AdminTeamRole,
} from './dto/admin-account-response.dto';
import {
  AdminAccountSort,
  AdminSortDirection,
  ListAdminAccountsQueryDto,
} from './dto/list-admin-accounts-query.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKS_IN_ACTIVITY = 12;
const TEAM_STATUS: Record<UserStatus, AdminTeamMemberStatus> = {
  [UserStatus.ACTIVE]: AdminTeamMemberStatus.ACTIVE,
  [UserStatus.PENDING]: AdminTeamMemberStatus.PENDING,
  [UserStatus.INACTIVE]: AdminTeamMemberStatus.INACTIVE,
};

@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger(AdminAccountsService.name);

  constructor(
    private readonly repository: AdminAccountsRepository,
    private readonly config: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly health: AccountHealthService,
    private readonly activation: AdminActivationRepository,
  ) {}

  async list(
    query: ListAdminAccountsQueryDto,
    now: Date = new Date(),
  ): Promise<AdminAccountListResponseDto> {
    const filter: AdminAccountsFilter = {
      search: query.search || undefined,
      situation: query.situation,
      planId: query.planId,
      trialEndingInDays: query.trialEndingInDays,
      inactiveDays: query.inactiveDays,
      health: query.health,
      sortBy: query.sortBy ?? AdminAccountSort.CREATED_AT,
      sortDir:
        (query.sortDir ?? AdminSortDirection.DESC) === AdminSortDirection.ASC
          ? 'ASC'
          : 'DESC',
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
      now,
    };

    await this.health.ensureFresh(now);

    const [page, counts] = await Promise.all([
      this.repository.findPage(filter),
      this.repository.countBySituation({
        search: filter.search,
        planId: filter.planId,
        now,
      }),
    ]);

    const ownerIds = page.items.map((i) => i.subscription.ownerId);
    const [metrics, healthRows] = await Promise.all([
      this.repository.loadMetrics(
        ownerIds,
        page.items.map((i) => i.subscription.id),
        saoPauloMonthRange(now),
        now,
      ),
      this.health.latestFor(ownerIds),
    ]);

    return {
      items: page.items.map((row) =>
        this.toItem(
          row,
          metrics,
          now,
          this.toHealthSummary(healthRows.get(row.subscription.ownerId)),
        ),
      ),
      total: page.total,
      counts: this.toCounts(counts),
    };
  }

  async getDetail(
    ownerId: string,
    range: { from?: Date; to?: Date } = {},
    now: Date = new Date(),
  ): Promise<AdminAccountDetailDto> {
    const row = await this.requireRow(ownerId);
    const month = saoPauloMonthRange(now);
    const period = { from: range.from ?? month.from, to: range.to ?? month.to };

    const metrics = await this.repository.loadMetrics(
      [ownerId],
      [row.subscription.id],
      month,
      now,
    );
    const [usage, deactivatedByName, health, healthHistory] = await Promise.all(
      [
        this.buildUsage(ownerId, period, now),
        row.ownerDeactivatedById
          ? this.repository.findPlatformAdminName(row.ownerDeactivatedById)
          : Promise.resolve(null),
        this.health.computeOne(ownerId, now),
        this.health.history(ownerId, now),
      ],
    );
    const healthDetail = this.toHealthDetail(health, now);

    return {
      ...this.toItem(row, metrics, now, this.toHealthSummary(healthDetail)),
      usage,
      accountDeactivatedByName: deactivatedByName,
      healthDetail,
      healthHistory,
    };
  }

  async getTeam(
    ownerId: string,
    days: AdminTeamPeriodDays = 30,
    now: Date = new Date(),
  ): Promise<AdminTeamResponseDto> {
    await this.requireRow(ownerId);
    const from = new Date(now.getTime() - days * MS_PER_DAY);
    const [users, usage] = await Promise.all([
      this.repository.findTeam(ownerId),
      this.activation.findMemberUsage(ownerId, { from, to: now }),
    ]);
    const usageByUser = new Map(usage.map((u) => [u.userId, u]));
    return {
      from,
      to: now,
      days,
      items: users.map((user) => this.toTeamMember(user, usageByUser)),
    };
  }

  private toTeamMember(
    user: User,
    usageByUser: Map<string, MemberUsageRow>,
  ): AdminTeamMemberDto {
    const usage = usageByUser.get(user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role:
        user.id === user.ownerId
          ? AdminTeamRole.OWNER
          : user.doctorProfile
            ? AdminTeamRole.DOCTOR
            : AdminTeamRole.COLLABORATOR,
      isDoctor: !!user.doctorProfile,
      permissions: permissionsOf(user),
      active: user.status === UserStatus.ACTIVE,
      status: TEAM_STATUS[user.status] ?? AdminTeamMemberStatus.INACTIVE,
      lastSeenAt: user.lastSeenAt ?? null,
      mfaEnabled: !!user.mfaEnabledAt,
      privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt ?? null,
      termsOfUseAcceptedAt: user.termsOfUseAcceptedAt ?? null,
      aiConsentAcceptedAt: user.aiConsentAcceptedAt ?? null,
      whatsappPhoneMasked: user.phone ? maskPhone(user.phone) : null,
      onboarding: memberOnboarding(user.onboardingState ?? null),
      usage: {
        surgeryRequests: usage?.surgeryRequests ?? 0,
        appointments: usage?.appointments ?? 0,
        recordsFinalized: usage?.recordsFinalized ?? 0,
        assistantMessages: usage?.assistantMessages ?? 0,
        aiCostUsdCents: usage?.aiCostUsdCents ?? 0,
      },
    };
  }

  async getSubscription(
    ownerId: string,
    now: Date = new Date(),
  ): Promise<AdminAccountSubscriptionDto> {
    const { subscription: sub } = await this.requireRow(ownerId);
    const situation = computeAccountSituation(sub, now);
    const { gateway, gatewayError, remote } = await this.readGateway(
      sub.gatewayProvider,
      sub.gatewayCustomerId,
      sub.gatewaySubscriptionId,
    );
    const internalBlock = internalAccessBlock(
      sub.status,
      sub.status === SubscriptionStatus.INTERNAL ? [] : remote,
    );
    const trialBlock = trialExtensionDecision(sub, remote).block;
    const deactivateBlock = deactivationBlock(sub.status, remote);
    const grantedByName = sub.internalAccessGrantedBy
      ? await this.repository.findPlatformAdminName(sub.internalAccessGrantedBy)
      : null;

    return {
      situation: situation.situation,
      daysLeft: situation.daysLeft,
      daysOverdue: situation.daysOverdue,
      status: sub.status,
      plan: this.toPlan(sub.plan),
      monthlyAmountCents: computeMonthlyAmountCents(sub, sub.plan, now),
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pastDueSince: sub.pastDueSince,
      suspendedAt: sub.suspendedAt,
      canceledAt: sub.canceledAt,
      gatewayCustomerId: sub.gatewayCustomerId,
      gatewaySubscriptionId: sub.gatewaySubscriptionId,
      stripeCustomerUrl: this.stripeCustomerUrl(sub.gatewayCustomerId),
      gateway,
      gatewayError,
      canGrantInternalAccess: internalBlock === null,
      internalAccessBlockedReason: internalBlock?.message ?? null,
      canExtendTrial: trialBlock === null,
      canDeactivate: deactivateBlock === null,
      deactivationBlockedReason: deactivateBlock?.message ?? null,
      trialExtensionBlockedReason: trialBlock?.message ?? null,
      internalAccessGrantedAt: sub.internalAccessGrantedAt ?? null,
      internalAccessGrantedByName: grantedByName,
    };
  }

  private async readGateway(
    provider: string,
    customerId: string | null,
    subscriptionId: string | null,
  ): Promise<{
    gateway: AdminAccountGatewayDto | null;
    gatewayError: boolean;
    remote: GatewaySubscription[] | null;
  }> {
    if (!customerId && !subscriptionId) {
      return { gateway: null, gatewayError: false, remote: [] };
    }
    if (provider !== this.gateway.providerId) {
      return { gateway: null, gatewayError: false, remote: null };
    }
    try {
      const [remoteSub, latestByCustomer, payment] = await Promise.all([
        subscriptionId
          ? this.gateway.getSubscriptionWithDiscount(subscriptionId)
          : Promise.resolve(null),
        customerId
          ? this.gateway.getLatestSubscriptionByCustomer(customerId)
          : Promise.resolve(null),
        customerId
          ? this.gateway.getCustomerPaymentSummary(customerId)
          : Promise.resolve(null),
      ]);
      return {
        remote: uniqueGatewaySubscriptions([remoteSub, latestByCustomer]),
        gateway: {
          status: remoteSub?.status ?? null,
          trialEndsAt: remoteSub?.trialEndsAt ?? null,
          currentPeriodEnd: remoteSub?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: remoteSub?.cancelAtPeriodEnd ?? false,
          discount: remoteSub?.discount ?? null,
          hasPaymentMethod: payment?.hasPaymentMethod ?? false,
          paymentBrand: payment?.brand ?? null,
          paymentLast4: payment?.last4 ?? null,
        },
        gatewayError: false,
      };
    } catch (err) {
      this.logger.warn(
        `[admin-accounts] leitura da Stripe falhou: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { gateway: null, gatewayError: true, remote: null };
    }
  }

  private stripeCustomerUrl(customerId: string | null): string | null {
    if (!customerId) return null;
    const key = this.config.get<string>('STRIPE_SECRET_KEY', '');
    const testMode = key.startsWith('sk_test_') || key.startsWith('rk_test_');
    return `https://dashboard.stripe.com/${testMode ? 'test/' : ''}customers/${customerId}`;
  }

  private async requireRow(
    ownerId: string,
  ): Promise<AdminAccountSubscriptionRow> {
    const row = await this.repository.findByOwnerId(ownerId);
    if (!row) throw new NotFoundException('Conta não encontrada');
    return row;
  }

  private toPlan(plan: {
    id: string;
    name: string;
    priceCents: number;
    billingPeriod: string;
  }): AdminAccountItemDto['plan'] {
    return {
      id: plan.id,
      name: plan.name,
      priceCents: plan.priceCents,
      billingPeriod: plan.billingPeriod,
    };
  }

  private toHealthSummary(
    health:
      | {
          score: number;
          band: AccountHealthBand;
          factors: AccountHealthFactor[];
        }
      | null
      | undefined,
  ): AdminAccountHealthSummaryDto | null {
    if (!health) return null;
    return {
      score: health.score,
      band: health.band,
      mainReason: health.factors[0]?.message ?? null,
    };
  }

  private toHealthDetail(
    health: AccountHealthResult | null,
    now: Date,
  ): AdminAccountHealthDetailDto | null {
    if (!health) return null;
    return {
      score: health.score,
      band: health.band,
      mainReason: health.factors[0]?.message ?? null,
      factors: health.factors,
      computedAt: now,
    };
  }

  private toItem(
    row: AdminAccountSubscriptionRow,
    metrics: AdminAccountsMetrics,
    now: Date,
    health: AdminAccountHealthSummaryDto | null,
  ): AdminAccountItemDto {
    const sub = row.subscription;
    const ownerId = sub.ownerId;
    const computed = computeAccountSituation(sub, now);
    const situation = row.ownerDeactivatedAt
      ? {
          situation: AdminAccountSituation.DEACTIVATED,
          daysLeft: null,
          daysOverdue: null,
        }
      : computed;
    const team = metrics.team.get(ownerId);
    const requests = metrics.surgeryRequests.get(ownerId);
    const quota = metrics.quota.get(ownerId);

    return {
      ownerId,
      name: row.ownerName,
      email: row.ownerEmail,
      createdAt: row.ownerCreatedAt,
      plan: this.toPlan(sub.plan),
      situation: situation.situation,
      daysLeft: situation.daysLeft,
      daysOverdue: situation.daysOverdue,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      monthlyAmountCents: computeMonthlyAmountCents(sub, sub.plan, now),
      hasGatewaySubscription: !!sub.gatewaySubscriptionId,
      doctors: team?.doctors ?? 0,
      collaborators: team?.collaborators ?? 0,
      surgeryRequestsThisMonth: requests?.month ?? 0,
      surgeryRequestsTotal: requests?.total ?? 0,
      quota: quota ?? { used: 0, limit: sub.plan.surgeryRequestQuota },
      appointmentsThisMonth: metrics.appointmentsMonth.get(ownerId) ?? 0,
      aiCostThisMonthUsdCents: metrics.aiCostMonthCents.get(ownerId) ?? 0,
      lastSeenAt: metrics.lastSeen.get(ownerId) ?? null,
      accountDeactivatedAt: row.ownerDeactivatedAt,
      health,
    };
  }

  private toCounts(
    rows: Array<{ situation: AdminAccountSituationKey; count: number }>,
  ): AdminAccountCountsDto {
    const counts: AdminAccountCountsDto = {
      all: 0,
      trial: 0,
      trial_expired: 0,
      active: 0,
      cancel_scheduled: 0,
      past_due: 0,
      suspended: 0,
      canceled: 0,
      internal: 0,
      deactivated: 0,
    };
    for (const r of rows) {
      counts[r.situation] += r.count;
      counts.all += r.count;
    }
    return counts;
  }

  private async buildUsage(
    ownerId: string,
    period: { from: Date; to: Date },
    now: Date,
  ): Promise<AdminAccountUsageDto> {
    const weekStart = saoPauloWeekStart(now);
    const firstWeek = new Date(
      weekStart.getTime() - (WEEKS_IN_ACTIVITY - 1) * 7 * MS_PER_DAY,
    );

    const [
      byStatus,
      appointments,
      patients,
      finalized,
      aiMessages,
      weeklySr,
      weeklyAp,
    ] = await Promise.all([
      this.repository.surgeryRequestsByStatus(ownerId, period),
      this.repository.appointmentsByStatus(ownerId, period),
      this.repository.patientCounts(ownerId, period),
      this.repository.finalizedRecordsCount(ownerId, period),
      this.repository.aiMessagesCount(ownerId, period),
      this.repository.weeklySurgeryRequests(ownerId, firstWeek),
      this.repository.weeklyAppointments(ownerId, firstWeek),
    ]);

    const statusMap = new Map(byStatus.map((r) => [r.status, r]));
    const statusCodes = Object.values(SurgeryRequestStatus).filter(
      (v): v is number => typeof v === 'number',
    );
    const countOf = (statuses: AppointmentStatus[]): number =>
      appointments
        .filter((a) => statuses.includes(a.status as AppointmentStatus))
        .reduce((sum, a) => sum + a.count, 0);

    const srByWeek = new Map(weeklySr.map((r) => [r.weekStart, r.count]));
    const apByWeek = new Map(weeklyAp.map((r) => [r.weekStart, r.count]));
    const activity = Array.from({ length: WEEKS_IN_ACTIVITY }, (_, i) => {
      const label = formatSaoPauloDate(
        new Date(firstWeek.getTime() + i * 7 * MS_PER_DAY),
      );
      return {
        weekStart: label,
        surgeryRequests: srByWeek.get(label) ?? 0,
        appointments: apByWeek.get(label) ?? 0,
      };
    });

    return {
      from: period.from,
      to: period.to,
      surgeryRequestsByStatus: statusCodes.map((status) => ({
        status,
        total: statusMap.get(status)?.total ?? 0,
        inPeriod: statusMap.get(status)?.period ?? 0,
      })),
      appointments: {
        scheduled: countOf([
          AppointmentStatus.SCHEDULED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.WAITING,
          AppointmentStatus.IN_PROGRESS,
        ]),
        completed: countOf([AppointmentStatus.COMPLETED]),
        cancelled: countOf([AppointmentStatus.CANCELLED]),
        noShow: countOf([AppointmentStatus.NO_SHOW]),
      },
      patients: { total: patients.total, newInPeriod: patients.created },
      finalizedRecordsInPeriod: finalized,
      aiMessagesInPeriod: aiMessages,
      activity,
    };
  }
}
