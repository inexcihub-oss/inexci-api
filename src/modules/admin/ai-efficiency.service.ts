import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';

export interface AiEfficiencyReport {
  windowFrom: string | null;
  windowTo: string | null;
  totalTurns: number;
  totalConversations: number;
  totalUsers: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgTotalTokens: number;
  p50TotalTokens: number;
  p95TotalTokens: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgCallsPerTurn: number;
  totalCachedTokens: number;
  cacheHitRate: number;
  rewriteRate: number;
  summaryStageRate: number;
  ragHitRate: number;
  avgRagScore: number;
  totalCostCents: number | null;
  avgCostCents: number | null;
  byDraftType: Array<{
    draftType: string;
    turns: number;
    avgPromptTokens: number;
    avgTotalTokens: number;
    cacheHitRate: number;
  }>;
  callsDistribution: Array<{ calls: number; turns: number; percent: number }>;
}

@Injectable()
export class AiEfficiencyService {
  constructor(
    @InjectRepository(AiTokenUsageLog)
    private readonly repo: Repository<AiTokenUsageLog>,
  ) {}

  async getReport(params: {
    from?: string;
    to?: string;
  }): Promise<AiEfficiencyReport> {
    const { from, to } = params;

    const where: string[] = [];
    const args: Record<string, unknown> = {};
    if (from) {
      where.push('log.created_at >= :from');
      args.from = from;
    }
    if (to) {
      where.push('log.created_at <= :to');
      args.to = to;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalsSql = `
      SELECT
        COUNT(*)::int                                            AS "totalTurns",
        COUNT(DISTINCT log.conversation_id)::int                  AS "totalConversations",
        COUNT(DISTINCT log.user_id)::int                          AS "totalUsers",
        COALESCE(AVG(log.prompt_tokens), 0)::float                AS "avgPromptTokens",
        COALESCE(AVG(log.completion_tokens), 0)::float            AS "avgCompletionTokens",
        COALESCE(AVG(log.total_tokens), 0)::float                 AS "avgTotalTokens",
        COALESCE(percentile_cont(0.5)
                   WITHIN GROUP (ORDER BY log.total_tokens), 0)::float
                                                                  AS "p50TotalTokens",
        COALESCE(percentile_cont(0.95)
                   WITHIN GROUP (ORDER BY log.total_tokens), 0)::float
                                                                  AS "p95TotalTokens",
        COALESCE(AVG(log.latency_ms), 0)::float                   AS "avgLatencyMs",
        COALESCE(percentile_cont(0.5)
                   WITHIN GROUP (ORDER BY log.latency_ms), 0)::float
                                                                  AS "p50LatencyMs",
        COALESCE(percentile_cont(0.95)
                   WITHIN GROUP (ORDER BY log.latency_ms), 0)::float
                                                                  AS "p95LatencyMs",
        COALESCE(AVG(log.calls_count), 0)::float                  AS "avgCallsPerTurn",
        COALESCE(SUM(log.cost_estimate_cents), 0)::int            AS "totalCostCents",
        COALESCE(AVG(log.cost_estimate_cents), 0)::float          AS "avgCostCents"
      FROM ai_token_usage_logs log
      ${whereSql}
    `;

    const cacheSql = `
      SELECT
        COALESCE(SUM(COALESCE((b->>'cachedTokens')::int, 0)), 0)::int AS "totalCachedTokens",
        COALESCE(SUM(COALESCE((b->>'promptTokens')::int, 0)), 0)::int AS "sumPromptInBreakdown"
      FROM ai_token_usage_logs log,
           LATERAL jsonb_array_elements(log.breakdown) b
      ${whereSql}
    `;

    const stageRatesSql = `
      SELECT
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(log.breakdown) b
          WHERE b->>'stage' = 'rewrite'
        ) THEN 1 ELSE 0 END)::int AS "turnsWithRewrite",
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(log.breakdown) b
          WHERE b->>'stage' = 'summary'
        ) THEN 1 ELSE 0 END)::int AS "turnsWithSummary",
        COUNT(*)::int AS "totalTurns"
      FROM ai_token_usage_logs log
      ${whereSql}
    `;

    const byDraftSql = `
      SELECT
        COALESCE((
          SELECT b->>'draftType' FROM jsonb_array_elements(log.breakdown) b
          WHERE b->>'stage' = 'initial' LIMIT 1
        ), 'none') AS "draftType",
        COUNT(*)::int                                          AS "turns",
        COALESCE(AVG(log.prompt_tokens), 0)::float             AS "avgPromptTokens",
        COALESCE(AVG(log.total_tokens), 0)::float              AS "avgTotalTokens",
        COALESCE(SUM((
          SELECT COALESCE(SUM(COALESCE((b->>'cachedTokens')::int, 0)), 0)
          FROM jsonb_array_elements(log.breakdown) b
        )), 0)::int                                            AS "cachedTokens",
        COALESCE(SUM(log.prompt_tokens), 0)::int               AS "sumPromptTokens"
      FROM ai_token_usage_logs log
      ${whereSql}
      GROUP BY 1
      ORDER BY "turns" DESC
      LIMIT 10
    `;

    const callsDistSql = `
      SELECT
        LEAST(log.calls_count, 5)::int AS calls,
        COUNT(*)::int                  AS turns
      FROM ai_token_usage_logs log
      ${whereSql}
      GROUP BY 1
      ORDER BY 1
    `;

    const ragMetricsSql = `
      SELECT
        COUNT(DISTINCT log.id)::int AS "totalTurnsWithRagData",
        SUM(CASE
          WHEN (b->'rag'->>'hitsCount')::int > 0 THEN 1 ELSE 0
        END)::int AS "turnsWithRagHit",
        COALESCE(AVG(
          CASE
            WHEN (b->'rag'->>'hitsCount')::int > 0
            THEN (b->'rag'->>'avgScore')::float
          END
        ), 0)::float AS "avgRagScore"
      FROM ai_token_usage_logs log,
           LATERAL jsonb_array_elements(log.breakdown) b
      WHERE b->'rag' IS NOT NULL
      ${where.length ? 'AND ' + where.join(' AND ') : ''}
    `;

    const totalsQ = this.bindNamed(totalsSql, args);
    const cacheQ = this.bindNamed(cacheSql, args);
    const stagesQ = this.bindNamed(stageRatesSql, args);
    const byDraftQ = this.bindNamed(byDraftSql, args);
    const callsQ = this.bindNamed(callsDistSql, args);
    const ragQ = this.bindNamed(ragMetricsSql, args);

    const [totals, cache, stages, byDraftRaw, callsRaw, ragRaw] =
      await Promise.all([
        this.repo.query<LinhaSql[]>(totalsQ.sql, totalsQ.params),
        this.repo.query<LinhaSql[]>(cacheQ.sql, cacheQ.params),
        this.repo.query<LinhaSql[]>(stagesQ.sql, stagesQ.params),
        this.repo.query<LinhaSql[]>(byDraftQ.sql, byDraftQ.params),
        this.repo.query<LinhaSql[]>(callsQ.sql, callsQ.params),
        this.repo.query<LinhaSql[]>(ragQ.sql, ragQ.params),
      ]);

    const t = totals[0] || {};
    const c = cache[0] || {};
    const s = stages[0] || {};
    const rag = ragRaw[0] || {};

    const totalTurns = Number(t.totalTurns) || 0;
    const turnsWithRewrite = Number(s.turnsWithRewrite) || 0;
    const turnsWithSummary = Number(s.turnsWithSummary) || 0;

    const totalCachedTokens = Number(c.totalCachedTokens) || 0;
    const sumPromptInBreakdown = Number(c.sumPromptInBreakdown) || 0;
    const cacheHitRate =
      sumPromptInBreakdown > 0
        ? Math.round((totalCachedTokens / sumPromptInBreakdown) * 100 * 10) / 10
        : 0;

    const byDraftType = byDraftRaw.map((row) => {
      const sumPrompt = Number(row.sumPromptTokens) || 0;
      const cached = Number(row.cachedTokens) || 0;
      return {
        draftType:
          typeof row.draftType === 'string' && row.draftType
            ? row.draftType
            : 'none',
        turns: Number(row.turns) || 0,
        avgPromptTokens: round1(row.avgPromptTokens),
        avgTotalTokens: round1(row.avgTotalTokens),
        cacheHitRate: sumPrompt > 0 ? round1((cached / sumPrompt) * 100) : 0,
      };
    });

    const callsDistribution = callsRaw.map((row) => {
      const turns = Number(row.turns) || 0;
      return {
        calls: Number(row.calls) || 0,
        turns,
        percent: totalTurns > 0 ? round1((turns / totalTurns) * 100) : 0,
      };
    });

    const turnsWithRagData = Number(rag.totalTurnsWithRagData) || 0;
    const turnsWithRagHit = Number(rag.turnsWithRagHit) || 0;
    const ragHitRate =
      turnsWithRagData > 0
        ? round1((turnsWithRagHit / turnsWithRagData) * 100)
        : 0;
    const avgRagScore = round2(rag.avgRagScore);

    return {
      windowFrom: from || null,
      windowTo: to || null,
      totalTurns,
      totalConversations: Number(t.totalConversations) || 0,
      totalUsers: Number(t.totalUsers) || 0,
      avgPromptTokens: round1(t.avgPromptTokens),
      avgCompletionTokens: round1(t.avgCompletionTokens),
      avgTotalTokens: round1(t.avgTotalTokens),
      p50TotalTokens: round1(t.p50TotalTokens),
      p95TotalTokens: round1(t.p95TotalTokens),
      avgLatencyMs: Math.round(Number(t.avgLatencyMs) || 0),
      p50LatencyMs: Math.round(Number(t.p50LatencyMs) || 0),
      p95LatencyMs: Math.round(Number(t.p95LatencyMs) || 0),
      avgCallsPerTurn: round2(t.avgCallsPerTurn),
      totalCachedTokens,
      cacheHitRate,
      rewriteRate:
        totalTurns > 0 ? round1((turnsWithRewrite / totalTurns) * 100) : 0,
      summaryStageRate:
        totalTurns > 0 ? round1((turnsWithSummary / totalTurns) * 100) : 0,
      totalCostCents:
        t.totalCostCents != null ? Number(t.totalCostCents) : null,
      avgCostCents:
        t.avgCostCents != null && totalTurns > 0
          ? round2(t.avgCostCents)
          : null,
      byDraftType,
      callsDistribution,
      ragHitRate,
      avgRagScore,
    };
  }

  private bindNamed(
    sql: string,
    args: Record<string, unknown>,
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const indexByKey = new Map<string, number>();
    const boundSql = sql.replace(/(?<!:):(\w+)\b/g, (_, key: string) => {
      if (!(key in args)) return `:${key}`;
      let idx = indexByKey.get(key);
      if (idx === undefined) {
        params.push(args[key]);
        idx = params.length;
        indexByKey.set(key, idx);
      }
      return `$${idx}`;
    });
    return { sql: boundSql, params };
  }
}

type LinhaSql = Record<string, unknown>;

function round1(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function round2(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
