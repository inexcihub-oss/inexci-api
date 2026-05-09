import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';

export interface AiUsageReportRow {
  groupKey: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCalls: number;
  totalCostCents: number | null;
  avgLatencyMs: number | null;
}

@Injectable()
export class AiUsageService {
  constructor(
    @InjectRepository(AiTokenUsageLog)
    private readonly repo: Repository<AiTokenUsageLog>,
  ) {}

  async getReport(params: {
    from?: string;
    to?: string;
    groupBy?: 'user' | 'model' | 'day';
  }): Promise<AiUsageReportRow[]> {
    const { from, to, groupBy = 'day' } = params;

    let groupCol: string;
    switch (groupBy) {
      case 'user':
        groupCol = "COALESCE(log.userId::text, 'anonymous')";
        break;
      case 'model':
        groupCol = "COALESCE(log.model, 'unknown')";
        break;
      case 'day':
      default:
        groupCol = 'DATE(log.createdAt)::text';
        break;
    }

    const qb = this.repo
      .createQueryBuilder('log')
      .select(groupCol, 'groupKey')
      .addSelect('SUM(log.promptTokens)', 'totalPromptTokens')
      .addSelect('SUM(log.completionTokens)', 'totalCompletionTokens')
      .addSelect('SUM(log.totalTokens)', 'totalTokens')
      .addSelect('SUM(log.callsCount)', 'totalCalls')
      .addSelect('SUM(log.costEstimateCents)', 'totalCostCents')
      .addSelect('AVG(log.latencyMs)', 'avgLatencyMs')
      .groupBy(groupCol)
      .orderBy(groupCol, 'ASC');

    if (from) {
      qb.andWhere('log.createdAt >= :from', { from });
    }
    if (to) {
      qb.andWhere('log.createdAt <= :to', { to });
    }

    const raw = await qb.getRawMany();

    return raw.map((r) => ({
      groupKey: r.groupKey,
      totalPromptTokens: Number(r.totalPromptTokens) || 0,
      totalCompletionTokens: Number(r.totalCompletionTokens) || 0,
      totalTokens: Number(r.totalTokens) || 0,
      totalCalls: Number(r.totalCalls) || 0,
      totalCostCents:
        r.totalCostCents != null ? Number(r.totalCostCents) : null,
      avgLatencyMs:
        r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null,
    }));
  }
}
