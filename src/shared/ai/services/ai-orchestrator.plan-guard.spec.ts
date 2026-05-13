import OpenAI from 'openai';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';
import { ResponseNormalizerService } from './orchestrator/response-normalizer.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { ClearContextDetectorService } from './orchestrator/clear-context-detector.service';
import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import { OrchestratorTelemetryService } from './orchestrator/orchestrator-telemetry.service';
import { MessageProcessorService } from './orchestrator/message-processor.service';

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
    aiTokenUsageLogRepo: { create: jest.fn() },
    config: {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'AI_USE_DRAFT_FLOWS') return 'true';
        return defaultValue;
      }),
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
      m.openai as any,
      m.conversation as any,
      m.toolRegistry as any,
      m.toolExecutor as any,
      m.rag as any,
      m.whatsapp as any,
      m.userRepo as any,
      m.accessControl as any,
      m.pendency as any,
      m.surgeryRequestRepo as any,
      m.config as any,
      m.whatsappMedia as any,
      m.piiVault as any,
      m.piiRedaction as any,
      m.aiRedis as any,
      m.context as any,
      m.whatsappConversationRepo as any,
      m.draft as any,
      new ResponseNormalizerService(),
      new PhoneNormalizerService(m.userRepo as any),
      new ClearContextDetectorService(),
      new ConfirmationManagerService(
        m.whatsappConversationRepo as any,
        m.conversation as any,
      ),
      new OrchestratorTelemetryService(
        m.aiTokenUsageLogRepo as any,
        new PhoneNormalizerService(m.userRepo as any),
      ),
      { run: jest.fn() } as any,
      {
        enqueueInboundMessage: jest.fn(),
        runPreflight: jest.fn(),
        invalidateUserCacheByPhone: jest.fn(),
      } as any,
      {
        processInboundDocumentIfNeeded: jest.fn().mockResolvedValue(false),
        buildDocumentPendingHint: jest.fn().mockResolvedValue(null),
      } as any,
      {
        processInboundAudioIfNeeded: jest.fn().mockResolvedValue({
          hasAudio: false,
          failed: false,
          transcription: null,
        }),
        buildUserInputForAi: jest
          .fn()
          .mockImplementation(({ textInput }: any) => textInput || ''),
        buildAudioFailureUserMessage: jest.fn().mockReturnValue('falha'),
        isAudioEnabled: jest.fn().mockReturnValue(true),
      } as any,
      {
        loadPersistedPiiBindings: jest.fn().mockResolvedValue({}),
        persistPiiBindings: jest.fn().mockResolvedValue(undefined),
        redactResidualPii: jest.fn().mockImplementation((t: string) => t),
      } as any,
    );

  // Sub-fase 3.9 (2026-05-12): COMPLEX_MUTATION_TOOL_NAMES esvaziado.
  // O guard `evaluatePlanFirstGuard` é agora um no-op (nenhuma tool no set).
  it('evaluatePlanFirstGuard: é no-op quando COMPLEX_MUTATION_TOOL_NAMES está vazio (Sub-fase 3.9)', async () => {
    const m = baseMocks();
    const service = buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'advance_surgery_request',
          arguments: '{}',
        },
      },
    ];
    const blocked = await (service as any).evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.size).toBe(0);
  });

  it('evaluatePlanFirstGuard: não bloqueia quando plan_actions está no mesmo turno', async () => {
    const m = baseMocks();
    const service = buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-plan',
        type: 'function',
        function: { name: 'plan_actions', arguments: '{}' },
      },
      {
        id: 'call-mut',
        type: 'function',
        function: { name: 'advance_surgery_request', arguments: '{}' },
      },
    ];
    const blocked = await (service as any).evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.size).toBe(0);
  });

  it('evaluatePlanFirstGuard: não bloqueia quando já existe operation_draft ativo', async () => {
    const m = baseMocks();
    m.draft.getCurrent.mockResolvedValue({
      type: 'create_sc',
      status: 'collecting',
      fields: {},
      startedAt: '',
      updatedAt: '',
    });
    const service = buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-mut',
        type: 'function',
        function: { name: 'advance_surgery_request', arguments: '{}' },
      },
    ];
    const blocked = await (service as any).evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.size).toBe(0);
  });

  it('evaluatePlanFirstGuard: desligado quando AI_USE_DRAFT_FLOWS=false', async () => {
    const m = baseMocks();
    m.config.get.mockImplementation((key: string, def?: any) => {
      if (key === 'AI_USE_DRAFT_FLOWS') return 'false';
      return def;
    });
    const service = buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-mut',
        type: 'function',
        function: { name: 'advance_surgery_request', arguments: '{}' },
      },
    ];
    const blocked = await (service as any).evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.size).toBe(0);
  });

  it('evaluatePlanFirstGuard: NÃO bloqueia tool de mutação SIMPLES (advance_surgery_request)', async () => {
    const m = baseMocks();
    const service = buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-mut',
        type: 'function',
        function: { name: 'advance_surgery_request', arguments: '{}' },
      },
    ];
    const blocked = await (service as any).evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.size).toBe(0);
  });
});
