import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  CompletionUsageSnapshot,
  OrchestratorTelemetryService,
} from './orchestrator-telemetry.service';
import { PhoneNormalizerService } from './phone-normalizer.service';
import { AiTokenUsageLogRepository } from '../../../../database/repositories/ai-token-usage-log.repository';
import { PiiVaultService } from '../pii-vault.service';

const buildCompletion = (
  overrides: Partial<OpenAI.ChatCompletion> = {},
  usage: Partial<OpenAI.CompletionUsage> & {
    prompt_tokens_details?: { cached_tokens?: number };
  } = {},
): OpenAI.ChatCompletion =>
  ({
    id: 'cmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o',
    choices: [],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      ...usage,
    } as any,
    ...overrides,
  }) as OpenAI.ChatCompletion;

describe('OrchestratorTelemetryService', () => {
  let service: OrchestratorTelemetryService;
  let aiTokenUsageLogRepo: jest.Mocked<
    Pick<AiTokenUsageLogRepository, 'create'>
  >;
  let phoneNormalizer: PhoneNormalizerService;
  let piiVault: jest.Mocked<Pick<PiiVaultService, 'categoryCounts'>>;

  beforeEach(() => {
    aiTokenUsageLogRepo = {
      create: jest.fn().mockResolvedValue({}),
    };
    phoneNormalizer = new PhoneNormalizerService({} as any);
    piiVault = {
      categoryCounts: jest.fn().mockReturnValue({}),
    };
    service = new OrchestratorTelemetryService(
      aiTokenUsageLogRepo as unknown as AiTokenUsageLogRepository,
      phoneNormalizer,
      piiVault as unknown as PiiVaultService,
    );
  });

  describe('captureUsageSnapshot', () => {
    it('appends snapshot with totals and metadata', () => {
      const snapshots: CompletionUsageSnapshot[] = [];
      service.captureUsageSnapshot(snapshots, 'initial', buildCompletion(), 42);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        stage: 'initial',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: 'gpt-4o',
        latencyMs: 42,
      });
    });

    it('captures cached tokens when present', () => {
      const snapshots: CompletionUsageSnapshot[] = [];
      service.captureUsageSnapshot(
        snapshots,
        'initial',
        buildCompletion({}, { prompt_tokens_details: { cached_tokens: 25 } }),
      );
      expect(snapshots[0].cachedTokens).toBe(25);
    });

    it('captures extras (cacheKey, toolsCount, draftType, breakdown, strategy)', () => {
      const snapshots: CompletionUsageSnapshot[] = [];
      service.captureUsageSnapshot(
        snapshots,
        'initial',
        buildCompletion(),
        10,
        {
          cacheKey: 'phone:5511999999999',
          toolsCount: 12,
          draftType: 'sc' as any,
          breakdown: {
            system_tokens: 1,
            summary_tokens: 2,
            memory_tokens: 3,
            rag_tokens: 4,
            recent_tokens: 5,
            totalTokens: 15,
          },
          strategy: 'hybrid',
        },
      );
      expect(snapshots[0]).toMatchObject({
        cacheKey: 'phone:5511999999999',
        toolsCount: 12,
        draftType: 'sc',
        contextStrategy: 'hybrid',
      });
      expect(snapshots[0].contextBreakdown?.totalTokens).toBe(15);
    });

    it('keeps draftType=null when explicitly informed', () => {
      const snapshots: CompletionUsageSnapshot[] = [];
      service.captureUsageSnapshot(
        snapshots,
        'initial',
        buildCompletion(),
        undefined,
        { draftType: null },
      );
      expect(snapshots[0]).toHaveProperty('draftType', null);
    });

    it('does nothing when completion has no usage', () => {
      const snapshots: CompletionUsageSnapshot[] = [];
      service.captureUsageSnapshot(snapshots, 'initial', {
        ...buildCompletion(),
        usage: undefined,
      } as OpenAI.ChatCompletion);
      expect(snapshots).toHaveLength(0);
    });

    it('does nothing when completion is null/undefined', () => {
      const snapshots: CompletionUsageSnapshot[] = [];
      service.captureUsageSnapshot(snapshots, 'initial', null);
      service.captureUsageSnapshot(snapshots, 'initial', undefined);
      expect(snapshots).toHaveLength(0);
    });
  });

  describe('estimateCostCents', () => {
    it('returns null when no snapshot maps to a known model', () => {
      const result = service.estimateCostCents([
        {
          stage: 'initial',
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          model: 'unknown-model',
        },
      ]);
      expect(result).toBeNull();
    });

    it('returns null when snapshots have no model', () => {
      const result = service.estimateCostCents([
        {
          stage: 'initial',
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      ]);
      expect(result).toBeNull();
    });

    it('estimates cost using MODEL_COST_PER_1K (gpt-4o)', () => {
      // gpt-4o: input 0.25¢/1K, output 1.0¢/1K -> (1*0.25 + 0.5*1) = 0.75 -> Math.round = 1
      const result = service.estimateCostCents([
        {
          stage: 'initial',
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          model: 'gpt-4o',
        },
      ]);
      expect(result).toBe(1);
    });

    it('aggregates cost across multiple snapshots and ignores unknown models', () => {
      const result = service.estimateCostCents([
        {
          stage: 'initial',
          promptTokens: 2000,
          completionTokens: 0,
          totalTokens: 2000,
          model: 'gpt-4o',
        },
        {
          stage: 'doc_classifier',
          promptTokens: 0,
          completionTokens: 1000,
          totalTokens: 1000,
          model: 'gpt-4o-mini',
        },
        {
          stage: 'noise',
          promptTokens: 1000,
          completionTokens: 0,
          totalTokens: 1000,
          model: 'unknown',
        },
      ]);
      // 2*0.25 + 1*0.06 = 0.56 -> Math.round = 1
      expect(result).toBe(1);
    });
  });

  describe('logUsageSummary', () => {
    it('does nothing when snapshots is empty', () => {
      const spy = jest.spyOn(Logger.prototype, 'log');
      service.logUsageSummary('5511999999999', 'sid', []);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('emits AI_TOKEN_USAGE log with masked phone, totals and cache rate', () => {
      const spy = jest.spyOn(Logger.prototype, 'log');
      service.logUsageSummary('5511999999999', 'sid-1', [
        {
          stage: 'initial',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedTokens: 25,
          toolsCount: 5,
          draftType: 'sc' as any,
          contextStrategy: 'hybrid',
          contextBreakdown: {
            system_tokens: 10,
            summary_tokens: 20,
            memory_tokens: 30,
            rag_tokens: 40,
            recent_tokens: 50,
            totalTokens: 150,
          },
        },
        {
          stage: 'tool_loop',
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
      ]);
      expect(spy).toHaveBeenCalledTimes(1);
      const message = spy.mock.calls[0][0] as string;
      expect(message).toContain('[AI_TOKEN_USAGE]');
      expect(message).toContain('sid=sid-1');
      expect(message).toContain('total_prompt=150');
      expect(message).toContain('total_completion=75');
      expect(message).toContain('total=225');
      expect(message).toContain('cached=25');
      expect(message).toContain('cache_rate=17%');
      expect(message).toContain('tools=5');
      expect(message).toContain('draft=sc');
      expect(message).toContain('strategy=hybrid');
      expect(message).toContain('ctx_system=10');
      spy.mockRestore();
    });

    it('falls back to draft=none and strategy=history_only when initial snapshot is missing', () => {
      const spy = jest.spyOn(Logger.prototype, 'log');
      service.logUsageSummary('5511999999999', 'sid-2', [
        {
          stage: 'tool_loop',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      ]);
      const message = spy.mock.calls[0][0] as string;
      expect(message).toContain('strategy=history_only');
      expect(message).toContain('draft=none');
      spy.mockRestore();
    });

    it('handles cache_rate=0 when no prompts were sent', () => {
      const spy = jest.spyOn(Logger.prototype, 'log');
      service.logUsageSummary('5511999999999', 'sid-3', [
        {
          stage: 'initial',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      ]);
      const message = spy.mock.calls[0][0] as string;
      expect(message).toContain('cache_rate=0%');
      spy.mockRestore();
    });
  });

  describe('persistUsageSummary', () => {
    it('does nothing when snapshots is empty', async () => {
      await service.persistUsageSummary(
        '5511999999999',
        'sid',
        'conv-1',
        'user-1',
        'owner-1',
        [],
      );
      expect(aiTokenUsageLogRepo.create).not.toHaveBeenCalled();
    });

    it('persists totals, model, latency and cost estimate', async () => {
      await service.persistUsageSummary(
        '5511999999999',
        'sid-1',
        'conv-1',
        'user-1',
        'owner-1',
        [
          {
            stage: 'initial',
            promptTokens: 1000,
            completionTokens: 500,
            totalTokens: 1500,
            model: 'gpt-4o',
            latencyMs: 100,
          },
          {
            stage: 'tool_loop',
            promptTokens: 200,
            completionTokens: 100,
            totalTokens: 300,
            model: 'gpt-4o',
            latencyMs: 50,
          },
        ],
      );
      expect(aiTokenUsageLogRepo.create).toHaveBeenCalledTimes(1);
      const payload = aiTokenUsageLogRepo.create.mock.calls[0][0];
      expect(payload.messageSid).toBe('sid-1');
      expect(payload.conversationId).toBe('conv-1');
      expect(payload.userId).toBe('user-1');
      expect(payload.ownerId).toBe('owner-1');
      expect(payload.promptTokens).toBe(1200);
      expect(payload.completionTokens).toBe(600);
      expect(payload.totalTokens).toBe(1800);
      expect(payload.callsCount).toBe(2);
      expect(payload.model).toBe('gpt-4o');
      expect(payload.latencyMs).toBe(150);
      expect(payload.phoneHash).toEqual(expect.any(String));
      expect(payload.costEstimateCents).toBeGreaterThan(0);
    });

    it('persists latencyMs=null when no latency informed', async () => {
      await service.persistUsageSummary(
        '5511999999999',
        'sid-2',
        'conv-1',
        'user-1',
        null,
        [
          {
            stage: 'initial',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            model: 'gpt-4o',
          },
        ],
      );
      const payload = aiTokenUsageLogRepo.create.mock.calls[0][0];
      expect(payload.latencyMs).toBeNull();
      expect(payload.ownerId).toBeNull();
    });

    it('does not throw when repository fails (warns instead)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      aiTokenUsageLogRepo.create.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.persistUsageSummary(
          '5511999999999',
          'sid-x',
          'conv-1',
          'user-1',
          'owner-1',
          [
            {
              stage: 'initial',
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
              model: 'gpt-4o',
            },
          ],
        ),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toContain('Falha ao persistir AI_TOKEN_USAGE');
      expect(message).toContain('db down');
      warnSpy.mockRestore();
    });
  });
});
