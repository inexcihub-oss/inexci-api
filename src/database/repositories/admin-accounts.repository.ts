import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { SubscriptionQuotaPeriod } from '../entities/subscription-quota-period.entity';
import { User } from '../entities/user.entity';
import { PlatformAdmin } from '../entities/platform-admin.entity';
import { SurgeryRequest } from '../entities/surgery-request.entity';
import { Appointment } from '../entities/appointment.entity';
import { Patient } from '../entities/patient.entity';
import { ClinicalRecord } from '../entities/clinical-record.entity';
import { AiTokenUsageLog } from '../entities/ai-token-usage-log.entity';
import { WhatsappConversationMessage } from '../entities/whatsapp-conversation-message.entity';
import { BaseRepository } from './base.repository';
import { AccountHealthBand } from '../entities/account-health-daily.entity';
import { HEALTH_BAND_SQL, HEALTH_SCORE_SQL } from './account-health.repository';

export type AdminAccountSituationKey =
  | 'trial'
  | 'trial_expired'
  | 'active'
  | 'cancel_scheduled'
  | 'past_due'
  | 'suspended'
  | 'canceled'
  | 'internal'
  | 'deactivated';

export type AdminAccountSortBy =
  | 'createdAt'
  | 'trialEndsAt'
  | 'lastSeenAt'
  | 'mrr'
  | 'health';

export interface AdminAccountsFilter {
  search?: string;
  situation?: AdminAccountSituationKey;
  planId?: string;
  trialEndingInDays?: number;
  inactiveDays?: number;
  health?: AccountHealthBand;
  sortBy: AdminAccountSortBy;
  sortDir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
  now: Date;
}

export interface AdminAccountSubscriptionRow {
  subscription: Subscription;
  ownerName: string;
  ownerEmail: string;
  ownerCreatedAt: Date;
  ownerDeactivatedAt: Date | null;
  ownerDeactivatedById: string | null;
}

export interface AdminAccountsMetrics {
  team: Map<string, { doctors: number; collaborators: number }>;
  surgeryRequests: Map<string, { total: number; month: number }>;
  appointmentsMonth: Map<string, number>;
  aiCostMonthCents: Map<string, number>;
  lastSeen: Map<string, Date | null>;
  quota: Map<string, { used: number; limit: number }>;
}

export interface AdminAccountCount {
  situation: AdminAccountSituationKey;
  count: number;
}

export interface AdminWeeklyActivityRow {
  weekStart: string;
  count: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const TIME_ZONE = 'America/Sao_Paulo';

export const LAST_SEEN_SQL =
  '(SELECT MAX(lu.last_seen_at) FROM users lu WHERE lu.owner_id = s.ownerId AND lu.deleted_at IS NULL)';
export const CLIENT_OWNER_IDS_SQL =
  "(SELECT cs.owner_id FROM subscriptions cs INNER JOIN users co ON co.id = cs.owner_id AND co.deleted_at IS NULL WHERE co.owner_id = co.id AND cs.status <> 'internal')";
const MRR_DISCOUNT_SQL =
  "(CASE WHEN p.priceCents <= 0 THEN 0 WHEN s.discountDuration = 'forever' OR (s.discountDuration = 'repeating' AND (s.discountEndsAt IS NULL OR s.discountEndsAt > :mrrNow)) THEN LEAST(p.priceCents, GREATEST(0, CASE WHEN s.discountPercentOff IS NOT NULL THEN ROUND(p.priceCents * s.discountPercentOff / 100) ELSE COALESCE(s.discountAmountOffCents, 0) END)) ELSE 0 END)";
const MRR_CHARGE_SQL = `(p.priceCents - ${MRR_DISCOUNT_SQL})`;
const MRR_SQL = `(CASE WHEN s.status IN ('active','past_due') AND NOT (s.status = 'active' AND s.trialEndsAt IS NOT NULL AND s.trialEndsAt > :mrrNow) THEN (CASE WHEN p.billingPeriod = 'YEARLY' THEN FLOOR(${MRR_CHARGE_SQL} / 12.0) ELSE ${MRR_CHARGE_SQL} END) ELSE 0 END)`;
const NOT_IN_TRIAL_SQL = '(s.trialEndsAt IS NULL OR s.trialEndsAt <= :now)';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class AdminAccountsRepository extends BaseRepository<Subscription> {
  constructor(@InjectRepository(Subscription) repo: Repository<Subscription>) {
    super(repo);
  }

  private baseQuery(): SelectQueryBuilder<Subscription> {
    return this.repository
      .createQueryBuilder('s')
      .innerJoin('s.owner', 'o')
      .innerJoin('s.plan', 'p')
      .where('o.ownerId = o.id');
  }

  private applyCommonFilters(
    qb: SelectQueryBuilder<Subscription>,
    filter: Pick<AdminAccountsFilter, 'search' | 'planId'>,
  ): void {
    if (filter.search) {
      const term = `%${escapeLike(filter.search.trim())}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('o.name ILIKE :search', { search: term }).orWhere(
            'o.email ILIKE :search',
            { search: term },
          );
        }),
      );
    }
    if (filter.planId) {
      qb.andWhere('s.planId = :planId', { planId: filter.planId });
    }
  }

  private applySituation(
    qb: SelectQueryBuilder<Subscription>,
    situation: AdminAccountSituationKey,
    now: Date,
  ): void {
    qb.setParameter('now', now);
    if (situation === 'deactivated') {
      qb.andWhere('o.accountDeactivatedAt IS NOT NULL');
      return;
    }
    qb.andWhere('o.accountDeactivatedAt IS NULL');
    switch (situation) {
      case 'trial':
        qb.andWhere(
          new Brackets((w) => {
            w.where(
              's.status = :stTrialing AND (s.trialEndsAt IS NULL OR s.trialEndsAt > :now)',
              { stTrialing: SubscriptionStatus.TRIALING },
            ).orWhere(
              's.status = :stActiveTrial AND s.trialEndsAt IS NOT NULL AND s.trialEndsAt > :now',
              { stActiveTrial: SubscriptionStatus.ACTIVE },
            );
          }),
        );
        return;
      case 'trial_expired':
        qb.andWhere(
          's.status = :stTrialing AND s.trialEndsAt IS NOT NULL AND s.trialEndsAt <= :now',
          { stTrialing: SubscriptionStatus.TRIALING },
        );
        return;
      case 'active':
        qb.andWhere(
          `s.status = :stActive AND s.cancelAtPeriodEnd = false AND ${NOT_IN_TRIAL_SQL}`,
          { stActive: SubscriptionStatus.ACTIVE },
        );
        return;
      case 'cancel_scheduled':
        qb.andWhere(
          `s.status = :stActive AND s.cancelAtPeriodEnd = true AND ${NOT_IN_TRIAL_SQL}`,
          { stActive: SubscriptionStatus.ACTIVE },
        );
        return;
      case 'past_due':
        qb.andWhere('s.status = :stSituation', {
          stSituation: SubscriptionStatus.PAST_DUE,
        });
        return;
      case 'suspended':
        qb.andWhere('s.status = :stSituation', {
          stSituation: SubscriptionStatus.SUSPENDED,
        });
        return;
      case 'canceled':
        qb.andWhere('s.status = :stSituation', {
          stSituation: SubscriptionStatus.CANCELED,
        });
        return;
      case 'internal':
        qb.andWhere('s.status = :stSituation', {
          stSituation: SubscriptionStatus.INTERNAL,
        });
        return;
    }
  }

  async findPage(
    filter: AdminAccountsFilter,
  ): Promise<{ items: AdminAccountSubscriptionRow[]; total: number }> {
    const qb = this.baseQuery();
    this.applyCommonFilters(qb, filter);
    if (filter.situation) {
      this.applySituation(qb, filter.situation, filter.now);
    }
    if (filter.trialEndingInDays !== undefined) {
      qb.andWhere(
        's.status IN (:...stTrialingEnding) AND s.trialEndsAt > :nowEnding AND s.trialEndsAt <= :trialLimit',
        {
          stTrialingEnding: [
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.ACTIVE,
          ],
          nowEnding: filter.now,
          trialLimit: new Date(
            filter.now.getTime() + filter.trialEndingInDays * MS_PER_DAY,
          ),
        },
      );
    }
    if (filter.inactiveDays !== undefined) {
      qb.andWhere(
        `(${LAST_SEEN_SQL} IS NULL OR ${LAST_SEEN_SQL} < :inactiveLimit)`,
        {
          inactiveLimit: new Date(
            filter.now.getTime() - filter.inactiveDays * MS_PER_DAY,
          ),
        },
      );
    }

    if (filter.health) {
      qb.andWhere(`${HEALTH_BAND_SQL} = :healthBand`, {
        healthBand: filter.health,
      });
    }

    const total = await qb.clone().getCount();

    const sortExpression = {
      createdAt: 'o.createdAt',
      trialEndsAt: 's.trialEndsAt',
      lastSeenAt: LAST_SEEN_SQL,
      mrr: MRR_SQL,
      health: HEALTH_SCORE_SQL,
    }[filter.sortBy];

    const rows = await qb
      .select([
        's',
        'o.id',
        'o.name',
        'o.email',
        'o.createdAt',
        'o.accountDeactivatedAt',
        'o.accountDeactivatedById',
        'p',
      ])
      .addSelect(sortExpression, 'sort_value')
      .setParameter('mrrNow', filter.now)
      .orderBy('sort_value', filter.sortDir, 'NULLS LAST')
      .addOrderBy('s.id', 'ASC')
      .offset(filter.offset)
      .limit(filter.limit)
      .getMany();

    return { items: rows.map((r) => this.toRow(r)), total };
  }

  private inactiveClientsQuery(
    inactiveDays: number,
    now: Date,
  ): SelectQueryBuilder<Subscription> {
    return this.baseQuery()
      .andWhere('s.status NOT IN (:...stNotInactiveEligible)', {
        stNotInactiveEligible: [
          SubscriptionStatus.INTERNAL,
          SubscriptionStatus.CANCELED,
        ],
      })
      .andWhere(
        `(${LAST_SEEN_SQL} IS NULL OR ${LAST_SEEN_SQL} < :inactiveLimit)`,
        {
          inactiveLimit: new Date(now.getTime() - inactiveDays * MS_PER_DAY),
        },
      );
  }

  async findInactiveClients(
    inactiveDays: number,
    now: Date,
    limit: number,
  ): Promise<{ items: AdminAccountSubscriptionRow[]; total: number }> {
    const qb = this.inactiveClientsQuery(inactiveDays, now);
    const total = await qb.clone().getCount();
    const rows = await qb
      .select([
        's',
        'o.id',
        'o.name',
        'o.email',
        'o.createdAt',
        'o.accountDeactivatedAt',
        'o.accountDeactivatedById',
        'p',
      ])
      .addSelect(LAST_SEEN_SQL, 'sort_value')
      .orderBy('sort_value', 'ASC', 'NULLS FIRST')
      .addOrderBy('s.id', 'ASC')
      .limit(limit)
      .getMany();
    return { items: rows.map((r) => this.toRow(r)), total };
  }

  async countInactiveClients(inactiveDays: number, now: Date): Promise<number> {
    const raw = await this.inactiveClientsQuery(inactiveDays, now)
      .select('COUNT(DISTINCT s.ownerId)', 'count')
      .getRawOne<{ count: string }>();
    return Number(raw?.count ?? 0);
  }

  async countClientsSeenSince(since: Date): Promise<number> {
    const raw = await this.baseQuery()
      .andWhere('s.status <> :stInternal', {
        stInternal: SubscriptionStatus.INTERNAL,
      })
      .andWhere(`${LAST_SEEN_SQL} >= :since`, { since })
      .select('COUNT(DISTINCT s.ownerId)', 'count')
      .getRawOne<{ count: string }>();
    return Number(raw?.count ?? 0);
  }

  async countClients(): Promise<number> {
    const raw = await this.baseQuery()
      .andWhere('s.status <> :stInternal', {
        stInternal: SubscriptionStatus.INTERNAL,
      })
      .select('COUNT(DISTINCT s.ownerId)', 'count')
      .getRawOne<{ count: string }>();
    return Number(raw?.count ?? 0);
  }

  async findByOwnerId(
    ownerId: string,
  ): Promise<AdminAccountSubscriptionRow | null> {
    const row = await this.baseQuery()
      .select([
        's',
        'o.id',
        'o.name',
        'o.email',
        'o.createdAt',
        'o.accountDeactivatedAt',
        'o.accountDeactivatedById',
        'p',
      ])
      .andWhere('s.ownerId = :ownerId', { ownerId })
      .orderBy('s.createdAt', 'DESC')
      .limit(1)
      .getOne();
    return row ? this.toRow(row) : null;
  }

  private toRow(subscription: Subscription): AdminAccountSubscriptionRow {
    return {
      subscription,
      ownerName: subscription.owner.name,
      ownerEmail: subscription.owner.email,
      ownerCreatedAt: subscription.owner.createdAt,
      ownerDeactivatedAt: subscription.owner.accountDeactivatedAt ?? null,
      ownerDeactivatedById: subscription.owner.accountDeactivatedById ?? null,
    };
  }

  async countBySituation(
    filter: Pick<AdminAccountsFilter, 'search' | 'planId' | 'now'>,
  ): Promise<AdminAccountCount[]> {
    const qb = this.baseQuery();
    this.applyCommonFilters(qb, filter);
    const raw = await qb
      .select('s.status', 'status')
      .addSelect('s.cancelAtPeriodEnd', 'cancel')
      .addSelect(
        '(s.trialEndsAt IS NOT NULL AND s.trialEndsAt <= :nowCount)',
        'expired',
      )
      .addSelect(
        '(s.trialEndsAt IS NOT NULL AND s.trialEndsAt > :nowCount)',
        'intrial',
      )
      .addSelect('(o.accountDeactivatedAt IS NOT NULL)', 'deactivated')
      .addSelect('COUNT(*)', 'count')
      .setParameter('nowCount', filter.now)
      .groupBy('s.status')
      .addGroupBy('s.cancelAtPeriodEnd')
      .addGroupBy('expired')
      .addGroupBy('intrial')
      .addGroupBy('deactivated')
      .getRawMany<{
        status: SubscriptionStatus;
        cancel: boolean;
        expired: boolean;
        intrial: boolean;
        deactivated: boolean;
        count: string;
      }>();

    const totals = new Map<AdminAccountSituationKey, number>();
    for (const r of raw) {
      const key = r.deactivated
        ? 'deactivated'
        : this.situationKeyOf(r.status, r.cancel, r.expired, r.intrial);
      totals.set(key, (totals.get(key) ?? 0) + Number(r.count));
    }
    return [...totals.entries()].map(([situation, count]) => ({
      situation,
      count,
    }));
  }

  private situationKeyOf(
    status: SubscriptionStatus,
    cancelAtPeriodEnd: boolean,
    trialExpired: boolean,
    inTrial: boolean,
  ): AdminAccountSituationKey {
    switch (status) {
      case SubscriptionStatus.TRIALING:
        return trialExpired ? 'trial_expired' : 'trial';
      case SubscriptionStatus.ACTIVE:
        if (inTrial) return 'trial';
        return cancelAtPeriodEnd ? 'cancel_scheduled' : 'active';
      case SubscriptionStatus.PAST_DUE:
        return 'past_due';
      case SubscriptionStatus.SUSPENDED:
        return 'suspended';
      case SubscriptionStatus.CANCELED:
        return 'canceled';
      case SubscriptionStatus.INTERNAL:
        return 'internal';
    }
  }

  async loadMetrics(
    ownerIds: string[],
    subscriptionIds: string[],
    month: { from: Date; to: Date },
    now: Date,
  ): Promise<AdminAccountsMetrics> {
    const metrics: AdminAccountsMetrics = {
      team: new Map(),
      surgeryRequests: new Map(),
      appointmentsMonth: new Map(),
      aiCostMonthCents: new Map(),
      lastSeen: new Map(),
      quota: new Map(),
    };
    if (ownerIds.length === 0) return metrics;
    const em = this.repository.manager;

    const [team, surgeryRequests, appointments, aiCost, quota] =
      await Promise.all([
        em
          .createQueryBuilder(User, 'u')
          .leftJoin('u.doctorProfile', 'dp')
          .select('u.ownerId', 'ownerId')
          .addSelect('COUNT(*) FILTER (WHERE dp.id IS NOT NULL)', 'doctors')
          .addSelect(
            'COUNT(*) FILTER (WHERE dp.id IS NULL AND u.id <> u.ownerId)',
            'collaborators',
          )
          .addSelect('MAX(u.lastSeenAt)', 'lastSeen')
          .where('u.ownerId IN (:...ownerIds)', { ownerIds })
          .groupBy('u.ownerId')
          .getRawMany<{
            ownerId: string;
            doctors: string;
            collaborators: string;
            lastSeen: Date | null;
          }>(),
        em
          .createQueryBuilder(SurgeryRequest, 'sr')
          .select('sr.ownerId', 'ownerId')
          .addSelect('COUNT(*)', 'total')
          .addSelect(
            'COUNT(*) FILTER (WHERE sr.createdAt >= :monthFrom AND sr.createdAt < :monthTo)',
            'month',
          )
          .where('sr.ownerId IN (:...ownerIds)', { ownerIds })
          .setParameters({ monthFrom: month.from, monthTo: month.to })
          .groupBy('sr.ownerId')
          .getRawMany<{ ownerId: string; total: string; month: string }>(),
        em
          .createQueryBuilder(Appointment, 'ap')
          .select('ap.ownerId', 'ownerId')
          .addSelect('COUNT(*)', 'count')
          .where('ap.ownerId IN (:...ownerIds)', { ownerIds })
          .andWhere(
            'ap.scheduledAt >= :monthFrom AND ap.scheduledAt < :monthTo',
          )
          .setParameters({ monthFrom: month.from, monthTo: month.to })
          .groupBy('ap.ownerId')
          .getRawMany<{ ownerId: string; count: string }>(),
        em
          .createQueryBuilder(AiTokenUsageLog, 'ai')
          .select('ai.ownerId', 'ownerId')
          .addSelect('COALESCE(SUM(ai.costEstimateCents), 0)', 'cost')
          .where('ai.ownerId IN (:...ownerIds)', { ownerIds })
          .andWhere('ai.createdAt >= :monthFrom AND ai.createdAt < :monthTo')
          .setParameters({ monthFrom: month.from, monthTo: month.to })
          .groupBy('ai.ownerId')
          .getRawMany<{ ownerId: string; cost: string }>(),
        subscriptionIds.length === 0
          ? Promise.resolve([] as SubscriptionQuotaPeriod[])
          : em
              .createQueryBuilder(SubscriptionQuotaPeriod, 'q')
              .innerJoin('q.subscription', 'qs')
              .select([
                'q.id',
                'q.surgeryRequestsUsed',
                'q.surgeryRequestsLimit',
                'qs.ownerId',
              ])
              .where('q.subscriptionId IN (:...subscriptionIds)', {
                subscriptionIds,
              })
              .andWhere('q.periodStart <= :now AND q.periodEnd > :now', { now })
              .getMany(),
      ]);

    for (const r of team) {
      metrics.team.set(r.ownerId, {
        doctors: Number(r.doctors),
        collaborators: Number(r.collaborators),
      });
      metrics.lastSeen.set(r.ownerId, r.lastSeen ? new Date(r.lastSeen) : null);
    }
    for (const r of surgeryRequests) {
      metrics.surgeryRequests.set(r.ownerId, {
        total: Number(r.total),
        month: Number(r.month),
      });
    }
    for (const r of appointments) {
      metrics.appointmentsMonth.set(r.ownerId, Number(r.count));
    }
    for (const r of aiCost) {
      metrics.aiCostMonthCents.set(r.ownerId, Number(r.cost));
    }
    for (const q of quota) {
      metrics.quota.set(q.subscription.ownerId, {
        used: q.surgeryRequestsUsed,
        limit: q.surgeryRequestsLimit,
      });
    }
    return metrics;
  }

  async surgeryRequestsByStatus(
    ownerId: string,
    range: { from: Date; to: Date },
  ): Promise<Array<{ status: number; total: number; period: number }>> {
    const raw = await this.repository.manager
      .createQueryBuilder(SurgeryRequest, 'sr')
      .select('sr.status', 'status')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        'COUNT(*) FILTER (WHERE sr.createdAt >= :from AND sr.createdAt < :to)',
        'period',
      )
      .where('sr.ownerId = :ownerId', { ownerId })
      .setParameters({ from: range.from, to: range.to })
      .groupBy('sr.status')
      .getRawMany<{ status: number; total: string; period: string }>();
    return raw.map((r) => ({
      status: Number(r.status),
      total: Number(r.total),
      period: Number(r.period),
    }));
  }

  async appointmentsByStatus(
    ownerId: string,
    range: { from: Date; to: Date },
  ): Promise<Array<{ status: string; count: number }>> {
    const raw = await this.repository.manager
      .createQueryBuilder(Appointment, 'ap')
      .select('ap.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('ap.ownerId = :ownerId', { ownerId })
      .andWhere('ap.scheduledAt >= :from AND ap.scheduledAt < :to', {
        from: range.from,
        to: range.to,
      })
      .groupBy('ap.status')
      .getRawMany<{ status: string; count: string }>();
    return raw.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async patientCounts(
    ownerId: string,
    range: { from: Date; to: Date },
  ): Promise<{ total: number; created: number }> {
    const raw = await this.repository.manager
      .createQueryBuilder(Patient, 'pt')
      .select('COUNT(*)', 'total')
      .addSelect(
        'COUNT(*) FILTER (WHERE pt.createdAt >= :from AND pt.createdAt < :to)',
        'created',
      )
      .where('pt.ownerId = :ownerId', { ownerId })
      .setParameters({ from: range.from, to: range.to })
      .getRawOne<{ total: string; created: string }>();
    return {
      total: Number(raw?.total ?? 0),
      created: Number(raw?.created ?? 0),
    };
  }

  finalizedRecordsCount(
    ownerId: string,
    range: { from: Date; to: Date },
  ): Promise<number> {
    return this.repository.manager
      .createQueryBuilder(ClinicalRecord, 'cr')
      .where('cr.ownerId = :ownerId', { ownerId })
      .andWhere('cr.finalizedAt >= :from AND cr.finalizedAt < :to', {
        from: range.from,
        to: range.to,
      })
      .getCount();
  }

  aiMessagesCount(
    ownerId: string,
    range: { from: Date; to: Date },
  ): Promise<number> {
    return this.repository.manager
      .createQueryBuilder(WhatsappConversationMessage, 'm')
      .innerJoin('m.conversation', 'c')
      .where('c.ownerId = :ownerId', { ownerId })
      .andWhere("m.role IN ('user', 'assistant')")
      .andWhere('m.createdAt >= :from AND m.createdAt < :to', {
        from: range.from,
        to: range.to,
      })
      .getCount();
  }

  async weeklySurgeryRequests(
    ownerId: string,
    from: Date,
  ): Promise<AdminWeeklyActivityRow[]> {
    const raw = await this.repository.manager
      .createQueryBuilder(SurgeryRequest, 'sr')
      .select(
        `to_char(date_trunc('week', sr.createdAt AT TIME ZONE '${TIME_ZONE}'), 'YYYY-MM-DD')`,
        'weekStart',
      )
      .addSelect('COUNT(*)', 'count')
      .where('sr.ownerId = :ownerId', { ownerId })
      .andWhere('sr.createdAt >= :from', { from })
      .groupBy('"weekStart"')
      .getRawMany<{ weekStart: string; count: string }>();
    return raw.map((r) => ({ weekStart: r.weekStart, count: Number(r.count) }));
  }

  async weeklyAppointments(
    ownerId: string,
    from: Date,
  ): Promise<AdminWeeklyActivityRow[]> {
    const raw = await this.repository.manager
      .createQueryBuilder(Appointment, 'ap')
      .select(
        `to_char(date_trunc('week', ap.scheduledAt AT TIME ZONE '${TIME_ZONE}'), 'YYYY-MM-DD')`,
        'weekStart',
      )
      .addSelect('COUNT(*)', 'count')
      .where('ap.ownerId = :ownerId', { ownerId })
      .andWhere('ap.scheduledAt >= :from', { from })
      .groupBy('"weekStart"')
      .getRawMany<{ weekStart: string; count: string }>();
    return raw.map((r) => ({ weekStart: r.weekStart, count: Number(r.count) }));
  }

  async findPlatformAdminName(adminId: string): Promise<string | null> {
    const admin = await this.repository.manager
      .createQueryBuilder(PlatformAdmin, 'pa')
      .select(['pa.id', 'pa.name'])
      .where('pa.id = :adminId', { adminId })
      .getOne();
    return admin?.name ?? null;
  }

  findTeam(ownerId: string): Promise<User[]> {
    return this.repository.manager
      .createQueryBuilder(User, 'u')
      .leftJoin('u.doctorProfile', 'dp')
      .select([
        'u.id',
        'u.name',
        'u.email',
        'u.role',
        'u.status',
        'u.permissions',
        'u.lastSeenAt',
        'u.ownerId',
        'u.phone',
        'u.mfaEnabledAt',
        'u.privacyPolicyAcceptedAt',
        'u.termsOfUseAcceptedAt',
        'u.aiConsentAcceptedAt',
        'u.onboardingState',
        'dp.id',
        'dp.council',
      ])
      .where('u.ownerId = :ownerId', { ownerId })
      .orderBy('u.name', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .getMany();
  }
}
