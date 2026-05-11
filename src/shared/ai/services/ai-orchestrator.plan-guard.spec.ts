import OpenAI from 'openai';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';

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
    toolRegistry: { getToolDefinitions: jest.fn() },
    toolExecutor: { executeMany: jest.fn() },
    rag: { search: jest.fn(), formatContext: jest.fn() },
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
  });

  const buildService = (m: ReturnType<typeof baseMocks>) =>
    new AiOrchestratorService(
      m.queue as any,
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
      m.aiTokenUsageLogRepo as any,
      m.config as any,
      m.transcription as any,
      m.whatsappMedia as any,
      m.piiVault as any,
      m.piiRedaction as any,
      m.aiRedis as any,
      m.context as any,
      m.whatsappConversationRepo as any,
      m.draft as any,
    );

  it('evaluatePlanFirstGuard: bloqueia tool de mutação complexa sem plan_actions nem draft ativo', async () => {
    const m = baseMocks();
    const service = buildService(m);
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'create_surgery_request_from_whatsapp',
          arguments: '{}',
        },
      },
    ];
    const blocked = await (service as any).evaluatePlanFirstGuard(
      toolCalls,
      'conv-1',
    );
    expect(blocked.has('call-1')).toBe(true);
  });

  it('evaluatePlanFirstGuard: libera quando plan_actions está no mesmo turno', async () => {
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
        function: {
          name: 'create_surgery_request_from_whatsapp',
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

  it('evaluatePlanFirstGuard: libera quando já existe operation_draft ativo', async () => {
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
        function: { name: 'invoice_request', arguments: '{}' },
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
        function: {
          name: 'create_surgery_request_from_whatsapp',
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
