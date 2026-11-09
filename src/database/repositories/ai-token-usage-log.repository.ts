import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiTokenUsageLog,
  AiUsageSource,
} from '../entities/ai-token-usage-log.entity';
import { User } from '../entities/user.entity';
import { CLIENT_OWNER_IDS_SQL, TIME_ZONE } from './admin-accounts.repository';
import { BaseRepository } from './base.repository';

export type AiUsageGroupBy = 'user' | 'owner' | 'model' | 'day';

export interface AiUsageReportFilters {
  from?: string;
  to?: string;
  groupBy?: AiUsageGroupBy;
  ownerId?: string;
  source?: AiUsageSource;
}

export interface AiUsageReportRawRow {
  groupKey: string;
  name: string | null;
  email: string | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCalls: number;
  totalRecords: number;
  costUsdCents: number | null;
  avgLatencyMs: number | null;
}

export interface AiCostSummary {
  clientMonthUsdCents: number;
  platformMonthUsdCents: number;
  clientLast30DaysUsdCents: number;
}

export interface AiOwnerCostRow {
  ownerId: string;
  name: string;
  email: string;
  costUsdCents: number;
  totalTokens: number;
}

const CLIENT_LOG_SQL = `log.ownerId IN ${CLIENT_OWNER_IDS_SQL}`;

interface RawReportRow {
  groupKey: string;
  name: string | null;
  email: string | null;
  totalPromptTokens: string | null;
  totalCompletionTokens: string | null;
  totalTokens: string | null;
  totalCalls: string | null;
  totalRecords: string | null;
  totalCostCents: string | null;
  avgLatencyMs: string | null;
}

@Injectable()
export class AiTokenUsageLogRepository extends BaseRepository<AiTokenUsageLog> {
  constructor(
    @InjectRepository(AiTokenUsageLog)
    repository: Repository<AiTokenUsageLog>,
  ) {
    super(repository);
  }

  async report(filters: AiUsageReportFilters): Promise<AiUsageReportRawRow[]> {
    const { from, to, groupBy = 'day', ownerId, source } = filters;

    let groupCol: string;
    switch (groupBy) {
      case 'user':
        groupCol = 'COALESCE("log"."user_id"::text, \'anonymous\')';
        break;
      case 'owner':
        groupCol = 'COALESCE("log"."owner_id"::text, \'none\')';
        break;
      case 'model':
        groupCol = 'COALESCE("log"."model", \'unknown\')';
        break;
      case 'day':
      default:
        groupCol = `DATE("log"."created_at" AT TIME ZONE '${TIME_ZONE}')::text`;
        break;
    }

    const qb = this.repository
      .createQueryBuilder('log')
      .select(groupCol, 'groupKey')
      .addSelect('SUM(log.promptTokens)', 'totalPromptTokens')
      .addSelect('SUM(log.completionTokens)', 'totalCompletionTokens')
      .addSelect('SUM(log.totalTokens)', 'totalTokens')
      .addSelect('SUM(log.callsCount)', 'totalCalls')
      .addSelect('COUNT(*)', 'totalRecords')
      .addSelect('SUM(log.costEstimateCents)', 'totalCostCents')
      .addSelect('AVG(log.latencyMs)', 'avgLatencyMs');

    if (groupBy === 'user' || groupBy === 'owner') {
      const joinColumn = groupBy === 'user' ? 'log.userId' : 'log.ownerId';
      qb.leftJoin(User, 'u', `u.id = ${joinColumn}`)
        .addSelect('u.name', 'name')
        .addSelect('u.email', 'email')
        .groupBy(groupCol)
        .addGroupBy('u.name')
        .addGroupBy('u.email');
    } else {
      qb.addSelect('NULL', 'name').addSelect('NULL', 'email').groupBy(groupCol);
    }

    if (groupBy === 'day') {
      qb.orderBy(groupCol, 'ASC');
    } else {
      qb.orderBy('SUM(log.totalTokens)', 'DESC');
    }

    if (from) qb.andWhere('log.createdAt >= :from', { from });
    if (to) qb.andWhere('log.createdAt <= :to', { to });
    if (ownerId) qb.andWhere('log.ownerId = :ownerId', { ownerId });
    if (source) qb.andWhere('log.source = :source', { source });

    const raw = await qb.getRawMany<RawReportRow>();

    return raw.map((r) => ({
      groupKey: r.groupKey,
      name: r.name ?? null,
      email: r.email ?? null,
      totalPromptTokens: Number(r.totalPromptTokens) || 0,
      totalCompletionTokens: Number(r.totalCompletionTokens) || 0,
      totalTokens: Number(r.totalTokens) || 0,
      totalCalls: Number(r.totalCalls) || 0,
      totalRecords: Number(r.totalRecords) || 0,
      costUsdCents: r.totalCostCents != null ? Number(r.totalCostCents) : null,
      avgLatencyMs:
        r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null,
    }));
  }

  async costSummary(
    month: { from: Date; to: Date },
    last30From: Date,
  ): Promise<AiCostSummary> {
    const minFrom = new Date(
      Math.min(month.from.getTime(), last30From.getTime()),
    );
    const inMonth = 'log.createdAt >= :monthFrom AND log.createdAt < :monthTo';
    const raw = await this.repository
      .createQueryBuilder('log')
      .select(
        `SUM(log.costEstimateCents) FILTER (WHERE ${inMonth} AND ${CLIENT_LOG_SQL})`,
        'clientMonth',
      )
      .addSelect(
        `SUM(log.costEstimateCents) FILTER (WHERE ${inMonth})`,
        'platformMonth',
      )
      .addSelect(
        `SUM(log.costEstimateCents) FILTER (WHERE log.createdAt >= :last30From AND ${CLIENT_LOG_SQL})`,
        'clientLast30',
      )
      .where('log.createdAt >= :minFrom AND log.createdAt < :monthTo')
      .setParameters({
        monthFrom: month.from,
        monthTo: month.to,
        last30From,
        minFrom,
      })
      .getRawOne<{
        clientMonth: string | null;
        platformMonth: string | null;
        clientLast30: string | null;
      }>();
    return {
      clientMonthUsdCents: Number(raw?.clientMonth) || 0,
      platformMonthUsdCents: Number(raw?.platformMonth) || 0,
      clientLast30DaysUsdCents: Number(raw?.clientLast30) || 0,
    };
  }

  async topOwnersByCost(
    range: { from: Date; to: Date },
    limit: number,
  ): Promise<AiOwnerCostRow[]> {
    const raw = await this.repository
      .createQueryBuilder('log')
      .innerJoin(User, 'ow', 'ow.id = log.ownerId')
      .select('ow.id', 'ownerId')
      .addSelect('ow.name', 'name')
      .addSelect('ow.email', 'email')
      .addSelect('COALESCE(SUM(log.costEstimateCents), 0)', 'cost')
      .addSelect('COALESCE(SUM(log.totalTokens), 0)', 'tokens')
      .where(CLIENT_LOG_SQL)
      .andWhere('log.createdAt >= :from AND log.createdAt < :to', range)
      .groupBy('ow.id')
      .addGroupBy('ow.name')
      .addGroupBy('ow.email')
      .orderBy('"cost"', 'DESC')
      .addOrderBy('ow.name', 'ASC')
      .addOrderBy('ow.id', 'ASC')
      .limit(limit)
      .getRawMany<{
        ownerId: string;
        name: string;
        email: string;
        cost: string;
        tokens: string;
      }>();
    return raw.map((r) => ({
      ownerId: r.ownerId,
      name: r.name,
      email: r.email,
      costUsdCents: Number(r.cost) || 0,
      totalTokens: Number(r.tokens) || 0,
    }));
  }
}
