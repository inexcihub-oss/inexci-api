import OpenAI from 'openai';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import { OrchestratorTelemetryService } from './orchestrator/orchestrator-telemetry.service';

describe('AiOrchestratorService — plan-first guard', () => {
  const baseMocks = () => ({
    queue: { add: jest.fn() },
    openai: { chatCompletion: jest.fn() },
    conversation: {
      getOrCreateConversation: jest.fn(),
      appendMessage: jest.fn(),
      resetConversationHistory: jest.fn(),
      loadRecentForLlm: jest.fn(),
    },
    toolRegistry: {
      getToolDefinitions: jest.fn().mockReturnValue([]),
      getToolDefinitionsForDraft: jest.fn().mockReturnValue([]),
    },
    toolExecutor: { executeMany: jest.fn() },
    rag: {
      search: jest.fn(),
      formatContext: jest.fn(),
      computeMetrics: jest
        .fn()
        .mockReturnValue({ hitsCount: 0, topScore: 0, avgScore: 0 }),
    },
    whatsapp: { sendMessage: jest.fn(), sendTemplate: jest.fn() },
    userRepo: { findOneByPhone: jest.fn() },
    accessControl: { getAccessibleDoctorIds: jest.fn() },
    pendency: { validateForStatus: jest.fn() },
    surgeryRequestRepo: { findOneSimple: jest.fn() },
    nextStepAdvisor: {
      appendNextStep: jest
        .fn()
        .mockImplementation(
          (_n: string, _a: unknown, output: string) => output,
        ),
    },
    aiTokenUsageLogRepo: { create: jest.fn() },
    config: {
      get: jest.fn((_key: string, defaultValue?: any) => defaultValue),
    },
    transcription: { transcribe: jest.fn() },
    whatsappMedia: {
      isAudioMime: jest.fn(),
      downloadInboundAudio: jest.fn(),
    },
    piiVault: new PiiVaultService(),
    piiRedaction: { create: jest.fn() },
    aiRedis: {
      isAvailable: false,
      checkRateLimit: jest.fn().mockResolvedValue(true),
      cacheGet: jest.fn().mockResolvedValue(null),
      cacheSet: jest.fn().mockResolvedValue(undefined),
      cacheDelete: jest.fn().mockResolvedValue(undefined),
      setFlag: jest.fn().mockResolvedValue(undefined),
      hasFlag: jest.fn().mockResolvedValue(false),
    },
    context: {
      buildContext: jest.fn(),
      shouldRefreshSummary: jest.fn().mockResolvedValue(false),
      updateSummaryAndMemory: jest.fn().mockResolvedValue(undefined),
    },
    whatsappConversationRepo: {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    },
    draft: {
      getCurrent: jest.fn().mockResolvedValue(null),
      getCurrentOfType: jest.fn().mockResolvedValue(null),
      start: jest.fn(),
      setField: jest.fn(),
      setFields: jest.fn(),
      setStatus: jest.fn(),
      validate: jest.fn(),
      getPreview: jest.fn(),
      cancel: jest.fn(),
      finalizeCommit: jest.fn(),
    },
    draftContext: {
      buildToolsForDraft: jest
        .fn()
        .mockResolvedValue({ tools: [], draftType: null }),
      buildCacheKey: jest.fn().mockReturnValue('inexci:wa:v1:draft=none'),
      evaluatePlanFirstGuard: jest.fn().mockResolvedValue(new Set()),
    },
    documentDispatcher: {
      isEnabled: jest.fn().mockReturnValue(false),
      pickDocumentMedia: jest.fn().mockReturnValue(null),
      stageInboundDocument: jest
        .fn()
        .mockResolvedValue({ status: 'no_document' }),
      getPending: jest.fn().mockResolvedValue(null),
      savePending: jest.fn().mockResolvedValue(undefined),
      clearPending: jest.fn().mockResolvedValue(undefined),
      deleteStoragePath: jest.fn().mockResolvedValue(undefined),
      parseIntent: jest.fn().mockReturnValue(null),
      buildDownloadFailureMessage: jest.fn().mockReturnValue('falha'),
      buildIntentPromptMessage: jest.fn().mockReturnValue('intent'),
    },
    documentProcessor: {
      processPendingDocument: jest
        .fn()
        .mockResolvedValue({ status: 'ok', userSummary: 'resumo' }),
    },
  });

  const buildService = (m: ReturnType<typeof baseMocks>) =>
    new AiOrchestratorService(
      m.config as any,
      m.openai as any,
      m.piiVault as any,
      {
        loadPersistedPiiBindings: jest.fn().mockResolvedValue({}),
        persistPiiBindings: jest.fn().mockResolvedValue(undefined),
        redactResidualPii: jest.fn().mockResolvedValue(undefined),
      } as any,
      m.conversation as any,
      m.context as any,
      new PhoneNormalizerService(m.userRepo as any),
      new OrchestratorTelemetryService(
        m.aiTokenUsageLogRepo as any,
        new PhoneNormalizerService(m.userRepo as any),
        {
          categoryCounts: jest.fn().mockReturnValue({}),
        } as unknown as PiiVaultService,
      ),
      { run: jest.fn() } as any,
      {
        enqueueInboundMessage: jest.fn(),
        runPreflight: jest.fn(),
        invalidateUserCacheByPhone: jest.fn(),
      } as any,
      null as any,
      null as any,
      null as any,
      null as any,
      m.whatsapp as any,
    );

  // Sub-fase 3.9 (2026-05-12): COMPLEX_MUTATION_TOOL_NAMES esvaziado.
  it('evaluatePlanFirstGuard: é no-op — sempre retorna set vazio', async () => {
    const m = baseMocks();
    buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'advance_surgery_request', arguments: '{}' },
      },
    ];
    const blocked = await m.draftContext.evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.size).toBe(0);
  });
});
