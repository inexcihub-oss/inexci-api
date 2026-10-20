import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiTokenUsageLogRepository } from '../../../../database/repositories/ai-token-usage-log.repository';
import { hashPhone } from '../../../crypto/phone-hash.util';
import { ContextStrategy } from '../conversation-context.service';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { MODEL_COST_PER_1K } from '../../constants/ai.constants';
import { PhoneNormalizerService } from './phone-normalizer.service';
import { PiiVaultService } from '../pii-vault.service';
import { errorMessage } from '../../../utils/error-message.util';

export interface CompletionUsageSnapshot {
  stage: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  latencyMs?: number;
  cachedTokens?: number;
  cacheKey?: string;
  toolsCount?: number;
  draftType?: OperationDraftType | null;
  contextBreakdown?: {
    system_tokens: number;
    summary_tokens: number;
    memory_tokens: number;
    rag_tokens: number;
    recent_tokens: number;
    totalTokens: number;
  };
  contextStrategy?: ContextStrategy;
  rag?: {
    hitsCount: number;
    topScore: number;
    avgScore: number;
  };
}

export interface CaptureUsageExtra {
  breakdown?: CompletionUsageSnapshot['contextBreakdown'];
  strategy?: ContextStrategy;
  cacheKey?: string;
  toolsCount?: number;
  draftType?: OperationDraftType | null;
  rag?: CompletionUsageSnapshot['rag'];
}

@Injectable()
export class OrchestratorTelemetryService {
  private readonly logger = new Logger(OrchestratorTelemetryService.name);

  constructor(
    private readonly aiTokenUsageLogRepo: AiTokenUsageLogRepository,
    private readonly phoneNormalizer: PhoneNormalizerService,
    private readonly piiVault: PiiVaultService,
  ) {}

  captureUsageSnapshot(
    snapshots: CompletionUsageSnapshot[],
    stage: string,
    completion: OpenAI.ChatCompletion | null | undefined,
    latencyMs?: number,
    extra?: CaptureUsageExtra,
  ): void {
    if (!completion?.usage) return;

    const cachedTokens =
      completion.usage.prompt_tokens_details?.cached_tokens ?? undefined;

    snapshots.push({
      stage,
      promptTokens: completion.usage.prompt_tokens || 0,
      completionTokens: completion.usage.completion_tokens || 0,
      totalTokens: completion.usage.total_tokens || 0,
      model: completion.model,
      latencyMs,
      ...(typeof cachedTokens === 'number' ? { cachedTokens } : {}),
      ...(extra?.cacheKey ? { cacheKey: extra.cacheKey } : {}),
      ...(typeof extra?.toolsCount === 'number'
        ? { toolsCount: extra.toolsCount }
        : {}),
      ...(extra && 'draftType' in extra ? { draftType: extra.draftType } : {}),
      ...(extra?.breakdown ? { contextBreakdown: extra.breakdown } : {}),
      ...(extra?.strategy ? { contextStrategy: extra.strategy } : {}),
      ...(extra?.rag ? { rag: extra.rag } : {}),
    });
  }

  logUsageSummary(
    phone: string,
    messageSid: string,
    snapshots: CompletionUsageSnapshot[],
  ): void {
    if (!snapshots.length) return;

    const totals = snapshots.reduce(
      (acc, item) => {
        acc.prompt += item.promptTokens;
        acc.completion += item.completionTokens;
        acc.total += item.totalTokens;
        acc.cached += item.cachedTokens || 0;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0, cached: 0 },
    );

    const breakdown = snapshots
      .map((item) => {
        const cached = item.cachedTokens ? `, cached:${item.cachedTokens}` : '';
        return `${item.stage}(p:${item.promptTokens}, c:${item.completionTokens}, t:${item.totalTokens}${cached})`;
      })
      .join(' | ');

    const initial = snapshots.find((s) => s.stage === 'initial');
    const ctxBreakdown = initial?.contextBreakdown;
    const strategy = initial?.contextStrategy ?? 'history_only';
    const ctxLog = ctxBreakdown
      ? ` strategy=${strategy} ctx_system=${ctxBreakdown.system_tokens} ctx_summary=${ctxBreakdown.summary_tokens} ctx_memory=${ctxBreakdown.memory_tokens} ctx_rag=${ctxBreakdown.rag_tokens} ctx_recent=${ctxBreakdown.recent_tokens}`
      : ` strategy=${strategy}`;

    const cacheRate =
      totals.prompt > 0 ? Math.round((totals.cached / totals.prompt) * 100) : 0;
    const draftLog = initial?.draftType
      ? ` draft=${initial.draftType}`
      : ' draft=none';
    const toolsLog =
      typeof initial?.toolsCount === 'number'
        ? ` tools=${initial.toolsCount}`
        : '';

    this.logger.log(
      `[AI_TOKEN_USAGE] sid=${messageSid} phone=${this.phoneNormalizer.maskPhone(phone)} total_prompt=${totals.prompt} total_completion=${totals.completion} total=${totals.total} cached=${totals.cached} cache_rate=${cacheRate}%${toolsLog}${draftLog} breakdown=${breakdown}${ctxLog}`,
    );
  }

  async persistUsageSummary(
    phone: string,
    messageSid: string,
    conversationId: string,
    userId: string,
    ownerId: string | null,
    snapshots: CompletionUsageSnapshot[],
  ): Promise<void> {
    if (!snapshots.length) return;

    const totals = snapshots.reduce(
      (acc, item) => {
        acc.prompt += item.promptTokens;
        acc.completion += item.completionTokens;
        acc.total += item.totalTokens;
        acc.latency += item.latencyMs || 0;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0, latency: 0 },
    );

    const model = snapshots[0]?.model ?? null;

    const costCents = this.estimateCostCents(snapshots);

    try {
      await this.aiTokenUsageLogRepo.create({
        messageSid,
        phoneHash: hashPhone(phone),
        conversationId,
        userId,
        ownerId,
        promptTokens: totals.prompt,
        completionTokens: totals.completion,
        totalTokens: totals.total,
        callsCount: snapshots.length,
        model,
        latencyMs: totals.latency || null,
        costEstimateCents: costCents,
        breakdown: snapshots,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao persistir AI_TOKEN_USAGE sid=${messageSid}: ${errorMessage(error) || 'erro desconhecido'}`,
      );
    }
  }

  estimateCostCents(snapshots: CompletionUsageSnapshot[]): number | null {
    let total = 0;
    let hasPricing = false;
    for (const s of snapshots) {
      const pricing = s.model ? MODEL_COST_PER_1K[s.model] : undefined;
      if (!pricing) continue;
      hasPricing = true;
      total +=
        (s.promptTokens / 1000) * pricing.input +
        (s.completionTokens / 1000) * pricing.output;
    }
    return hasPricing ? Math.round(total) : null;
  }

  logPiiVaultUsage(messageSid: string, conversationId: string): void {
    try {
      const counts = this.piiVault.categoryCounts(conversationId);
      const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
      if (!nonZero.length) return;
      const breakdown = nonZero.map(([cat, n]) => `${cat}=${n}`).join(',');
      const total = nonZero.reduce((acc, [, n]) => acc + n, 0);
      this.logger.log(
        `[AI_PII_USAGE] sid=${messageSid} total=${total} ${breakdown}`,
      );
    } catch (err) {
      this.logger.debug(
        `Falha ao calcular métrica de PII: ${errorMessage(err) || 'erro desconhecido'}`,
      );
    }
  }
}
