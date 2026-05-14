import OpenAI from 'openai';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';
import { WHATSAPP_TEMPLATES } from '../../whatsapp/whatsapp-templates.constants';
import { ResponseNormalizerService } from './orchestrator/response-normalizer.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { ClearContextDetectorService } from './orchestrator/clear-context-detector.service';
import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import { OrchestratorTelemetryService } from './orchestrator/orchestrator-telemetry.service';
import { ToolLoopRunnerService } from './orchestrator/tool-loop-runner.service';
import { MessageProcessorService } from './orchestrator/message-processor.service';
import { AudioIntakeService } from './orchestrator/audio-intake.service';
import { PiiBindingService } from './orchestrator/pii-binding.service';
import { ConversationMemoryService } from './orchestrator/conversation-memory.service';
import { NextStepAdvisorService } from './orchestrator/next-step-advisor.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';

describe('AiOrchestratorService (tool-calls integration)', () => {
  const queueMock = { add: jest.fn() };
  const openaiServiceMock = { chatCompletion: jest.fn() };
  const conversationServiceMock = {
    getOrCreateConversation: jest.fn(),
    appendMessage: jest.fn(),
    resetConversationHistory: jest.fn(),
    loadRecentForLlm: jest.fn(),
  };
  const defaultContextServiceMock = {
    buildContext: jest.fn(),
    shouldRefreshSummary: jest.fn().mockResolvedValue(false),
    updateSummaryAndMemory: jest.fn().mockResolvedValue(undefined),
  };
  const toolRegistryMock = {
    getToolDefinitions: jest.fn(),
    getToolDefinitionsForDraft: jest.fn(),
  };
  const toolExecutorMock = { executeMany: jest.fn() };
  const ragServiceMock = {
    search: jest.fn(),
    formatContext: jest.fn(),
    computeMetrics: jest
      .fn()
      .mockReturnValue({ hitsCount: 0, topScore: 0, avgScore: 0 }),
  };
  const whatsappServiceMock = {
    sendMessage: jest.fn(),
    sendTemplate: jest.fn(),
  };
  const userRepositoryMock = { findOneByPhone: jest.fn() };
  const accessControlMock = { getAccessibleDoctorIds: jest.fn() };
  const pendencyValidatorMock = { validateForStatus: jest.fn() };
  const surgeryRequestRepoMock = { findOneSimple: jest.fn() };
  const nextStepAdvisorService = new NextStepAdvisorService(
    surgeryRequestRepoMock as unknown as SurgeryRequestRepository,
    pendencyValidatorMock as unknown as PendencyValidatorService,
  );
  const aiTokenUsageLogRepoMock = { create: jest.fn() };
  const transcriptionServiceMock = { transcribe: jest.fn() };
  const whatsappMediaServiceMock = {
    isAudioMime: jest.fn(),
    downloadInboundAudio: jest.fn(),
  };
  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'AI_PROCESS_TIMEOUT_MS') return 90000;
      if (key === 'AI_AUDIO_ENABLED') return 'true';
      return defaultValue;
    }),
  };
  const piiRedactionLogRepoMock = { create: jest.fn() };
  const whatsappConversationRepoMock = {
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const draftContextMock = {
    buildToolsForDraft: jest
      .fn()
      .mockResolvedValue({ tools: [], draftType: null }),
    buildCacheKey: jest.fn().mockReturnValue('inexci:wa:v1:draft=none'),
    evaluatePlanFirstGuard: jest.fn().mockResolvedValue(new Set()),
  };
  const operationDraftServiceMock = {
    getCurrent: jest.fn().mockResolvedValue(null),
    getCurrentOfType: jest.fn().mockResolvedValue(null),
    start: jest.fn().mockResolvedValue(null),
    setField: jest.fn().mockResolvedValue(null),
    setFields: jest.fn().mockResolvedValue(null),
    setStatus: jest.fn().mockResolvedValue(null),
    validate: jest
      .fn()
      .mockResolvedValue({ isReady: false, missing: [], draft: null }),
    getPreview: jest.fn().mockResolvedValue({ text: '', draft: null }),
    cancel: jest.fn().mockResolvedValue(undefined),
    finalizeCommit: jest.fn().mockResolvedValue(null),
  };
  const documentDispatcherMock = {
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
  };
  const documentProcessorMock = {
    processPendingDocument: jest
      .fn()
      .mockResolvedValue({ status: 'ok', userSummary: 'resumo do documento' }),
  };
  const documentIntakeMock = {
    processInboundDocumentIfNeeded: jest.fn().mockResolvedValue(false),
    buildDocumentPendingHint: jest.fn().mockResolvedValue(null),
  };
  const audioIntakeMock = {
    processInboundAudioIfNeeded: jest.fn().mockResolvedValue({
      hasAudio: false,
      failed: false,
      transcription: null,
    }),
    buildUserInputForAi: jest
      .fn()
      .mockImplementation(
        ({
          textInput,
          transcriptionText,
        }: {
          textInput: string;
          transcriptionText: string | null;
        }) => textInput || transcriptionText || '',
      ),
    buildAudioFailureUserMessage: jest
      .fn()
      .mockReturnValue('falha ao transcrever'),
    isAudioEnabled: jest.fn().mockReturnValue(true),
  };
  const piiBindingMock = {
    loadPersistedPiiBindings: jest.fn().mockResolvedValue({}),
    persistPiiBindings: jest.fn().mockResolvedValue(undefined),
    redactResidualPii: jest.fn().mockImplementation((text: string) => text),
  };
  const aiRedisMock = {
    isAvailable: false,
    checkRateLimit: jest.fn().mockResolvedValue(true),
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
    cacheDelete: jest.fn().mockResolvedValue(undefined),
    setFlag: jest.fn().mockResolvedValue(undefined),
    hasFlag: jest.fn().mockResolvedValue(false),
  };
  let piiVault: PiiVaultService;

  let service: AiOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();

    configServiceMock.get.mockImplementation(
      (key: string, defaultValue?: any) => {
        if (key === 'AI_PROCESS_TIMEOUT_MS') return 90000;
        if (key === 'AI_AUDIO_ENABLED') return 'true';
        return defaultValue;
      },
    );

    (WHATSAPP_TEMPLATES as any).AI_ACTION_CONFIRMATION = '';

    piiVault = new PiiVaultService();
    piiRedactionLogRepoMock.create.mockResolvedValue(undefined);

    service = new AiOrchestratorService(
      openaiServiceMock as any,
      conversationServiceMock as any,
      toolRegistryMock as any,
      toolExecutorMock as any,
      ragServiceMock as any,
      whatsappServiceMock as any,
      userRepositoryMock as any,
      accessControlMock as any,
      configServiceMock as any,
      whatsappMediaServiceMock as any,
      piiVault,
      piiRedactionLogRepoMock as any,
      aiRedisMock as any,
      defaultContextServiceMock as any,
      whatsappConversationRepoMock as any,
      new ResponseNormalizerService(),
      new PhoneNormalizerService(userRepositoryMock as any),
      new ClearContextDetectorService(),
      new ConfirmationManagerService(
        whatsappConversationRepoMock as any,
        conversationServiceMock as any,
      ),
      new OrchestratorTelemetryService(
        aiTokenUsageLogRepoMock as any,
        new PhoneNormalizerService(userRepositoryMock as any),
        {
          categoryCounts: jest.fn().mockReturnValue({}),
        } as unknown as PiiVaultService,
      ),
      new ToolLoopRunnerService(
        openaiServiceMock as any,
        toolExecutorMock as any,
        new ConfirmationManagerService(
          whatsappConversationRepoMock as any,
          conversationServiceMock as any,
        ),
        new OrchestratorTelemetryService(
          aiTokenUsageLogRepoMock as any,
          new PhoneNormalizerService(userRepositoryMock as any),
          {
            categoryCounts: jest.fn().mockReturnValue({}),
          } as unknown as PiiVaultService,
        ),
      ),
      new MessageProcessorService(
        queueMock as any,
        configServiceMock as any,
        aiRedisMock as any,
        whatsappServiceMock as any,
        openaiServiceMock as any,
        ragServiceMock as any,
        piiVault as any,
        new PhoneNormalizerService(userRepositoryMock as any),
        new ResponseNormalizerService(),
      ),
      documentIntakeMock as any,
      new AudioIntakeService(
        whatsappMediaServiceMock as any,
        transcriptionServiceMock as any,
        configServiceMock as any,
      ),
      new PiiBindingService(
        piiVault,
        aiRedisMock as any,
        piiRedactionLogRepoMock as any,
      ),
      {
        memorizeEntities: jest.fn().mockResolvedValue(undefined),
        resolveDoctorsInfo: jest.fn().mockResolvedValue([]),
        readMemory: jest.fn().mockResolvedValue(null),
        patchMemory: jest.fn().mockResolvedValue(undefined),
      } as unknown as ConversationMemoryService,
      nextStepAdvisorService,
      draftContextMock as any,
    );

    userRepositoryMock.findOneByPhone.mockResolvedValue({
      id: 'user-1',
      aiConsentAcceptedAt: new Date('2026-01-01T00:00:00Z'),
    });
    accessControlMock.getAccessibleDoctorIds.mockResolvedValue(['doctor-1']);

    const conversation = {
      id: 'conv-1',
      phone: '+5511999999999',
      userId: 'user-1',
      messagesHistory: [],
    };

    conversationServiceMock.getOrCreateConversation.mockResolvedValue(
      conversation,
    );
    conversationServiceMock.appendMessage.mockResolvedValue(undefined);
    conversationServiceMock.resetConversationHistory.mockResolvedValue(
      undefined,
    );
    conversationServiceMock.loadRecentForLlm.mockResolvedValue([]);
    defaultContextServiceMock.buildContext.mockImplementation(
      async ({ conversation }: any) => ({
        messages: [
          { role: 'system', content: 'system' },
          ...(conversation?.messagesHistory ?? []).map((m: any) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        breakdown: {
          system_tokens: 5,
          summary_tokens: 0,
          memory_tokens: 0,
          rag_tokens: 0,
          recent_tokens: 5,
          totalTokens: 10,
        },
        strategy: 'hybrid',
        recentCount: (conversation?.messagesHistory ?? []).length,
      }),
    );
    defaultContextServiceMock.shouldRefreshSummary.mockResolvedValue(false);
    defaultContextServiceMock.updateSummaryAndMemory.mockResolvedValue(
      undefined,
    );

    ragServiceMock.search.mockResolvedValue([]);
    ragServiceMock.formatContext.mockResolvedValue('');
    toolRegistryMock.getToolDefinitions.mockReturnValue([]);
    toolRegistryMock.getToolDefinitionsForDraft.mockReturnValue([]);
    pendencyValidatorMock.validateForStatus.mockResolvedValue({
      pendencies: [],
    });
    surgeryRequestRepoMock.findOneSimple.mockResolvedValue({
      id: 'req-1',
      doctorId: 'doctor-1',
    });
    aiTokenUsageLogRepoMock.create.mockResolvedValue(undefined);
    whatsappMediaServiceMock.isAudioMime.mockImplementation(
      (mime: string | null) => Boolean(mime?.startsWith('audio/')),
    );
    whatsappMediaServiceMock.downloadInboundAudio.mockResolvedValue({
      buffer: Buffer.from('audio-bytes'),
      mimeType: 'audio/ogg',
      sizeBytes: 1024,
      durationSeconds: 18,
      fileName: 'audio.ogg',
    });
    transcriptionServiceMock.transcribe.mockResolvedValue({
      text: 'texto transcrito',
      provider: 'faster_whisper',
      latencyMs: 120,
      language: 'pt-BR',
      confidence: 0.89,
      durationSeconds: 18,
      fallbackUsed: false,
    });
  });

  it('deve manter loop de tool_calls e responder com follow-up', async () => {
    const toolCall: OpenAI.ChatCompletionMessageToolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'advance_surgery_request',
        arguments: JSON.stringify({ surgeryRequestId: 'req-1' }),
      },
    };

    openaiServiceMock.chatCompletion
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall] } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Resposta final', tool_calls: null } }],
      });

    toolExecutorMock.executeMany.mockResolvedValue([
      { toolCallId: 'call-1', output: 'preview ok' },
    ]);

    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'confirmar data',
      messageSid: 'SM1',
      mediaUrl: null,
    });

    expect(toolExecutorMock.executeMany).toHaveBeenCalledTimes(1);
    expect(openaiServiceMock.chatCompletion).toHaveBeenCalledTimes(2);
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511999999999',
      'Resposta final',
    );
    expect(whatsappServiceMock.sendTemplate).not.toHaveBeenCalled();
  });

  it('deve manter resposta atual quando não houver tool_calls', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Resposta direta', tool_calls: null } }],
    });

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: 'olá',
      messageSid: 'SM2',
      mediaUrl: null,
    });

    expect(toolExecutorMock.executeMany).not.toHaveBeenCalled();
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      'Resposta direta',
    );
    expect(whatsappServiceMock.sendTemplate).not.toHaveBeenCalled();
  });

  it('deve enviar template interativo quando resposta exigir confirmação de ação', async () => {
    (WHATSAPP_TEMPLATES as any).AI_ACTION_CONFIRMATION =
      'HX_CONFIRM_INTERACTIVE';

    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              'A solicitação SC-0042 será encerrada. Confirme com "sim" para executar.',
            tool_calls: null,
          },
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: 'encerrar solicitação sc-0042',
      messageSid: 'SM-CONFIRM',
      mediaUrl: null,
    });

    expect(whatsappServiceMock.sendTemplate).toHaveBeenCalledWith(
      '+5511888888888',
      'HX_CONFIRM_INTERACTIVE',
      {
        '1': 'A solicitação SC-0042 será encerrada. Confirme com "sim" para executar.',
      },
    );
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      'A solicitação SC-0042 será encerrada. Confirme com "sim" para executar.',
    );
  });

  it('deve transcrever áudio antes da busca RAG quando não houver texto', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [
        { message: { content: 'Recebi seu áudio.', tool_calls: null } },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: '',
      messageSid: 'SM-AUDIO',
      mediaUrl: 'https://api.twilio.com/media/audio-1',
      media: [
        {
          url: 'https://api.twilio.com/media/audio-1',
          contentType: 'audio/ogg',
          category: 'audio',
          durationSeconds: 18,
        },
      ],
    });

    expect(whatsappMediaServiceMock.downloadInboundAudio).toHaveBeenCalled();
    expect(transcriptionServiceMock.transcribe).toHaveBeenCalled();
    expect(ragServiceMock.search).toHaveBeenCalledWith('texto transcrito');
    expect(conversationServiceMock.appendMessage).toHaveBeenCalledWith(
      'conv-1',
      'user',
      'texto transcrito',
      undefined,
      expect.objectContaining({
        source: 'audio',
        transcription: expect.objectContaining({
          provider: 'faster_whisper',
          text: 'texto transcrito',
        }),
      }),
    );
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      '🎧 Recebi seu áudio. Estou analisando e já te respondo.',
    );
  });

  it('deve enviar mensagem amigável quando falhar a análise do áudio sem texto', async () => {
    whatsappMediaServiceMock.downloadInboundAudio.mockRejectedValueOnce(
      new Error('erro no download'),
    );

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: '',
      messageSid: 'SM-AUDIO-FAIL',
      mediaUrl: 'https://api.twilio.com/media/audio-2',
      media: [
        {
          url: 'https://api.twilio.com/media/audio-2',
          contentType: 'audio/ogg',
          category: 'audio',
          durationSeconds: 15,
        },
      ],
    });

    expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
    const audioCall = whatsappServiceMock.sendMessage.mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === 'string' &&
        (call[1] as string).includes('Não consegui transcrever'),
    );
    expect(audioCall).toBeTruthy();
    expect(audioCall?.[0]).toBe('+5511888888888');
  });

  // Fase 4 (PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA): rewriteForWhatsappQuality
  // removida. normalizeWhatsappText agora sanitiza diretamente sem LLM.
  it('deve normalizar resposta mal formatada via normalizeWhatsappText (sem rewrite LLM)', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '# Status\n- item técnico\n```json\n{"ok":true}\n```',
            tool_calls: null,
          },
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: 'como está minha solicitação?',
      messageSid: 'SM3',
      mediaUrl: null,
    });

    // Apenas 1 chamada ao LLM (sem segundo call de rewrite).
    expect(openaiServiceMock.chatCompletion).toHaveBeenCalledTimes(1);
    // normalizeWhatsappText: strip code block → strip header # → convert bullet.
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      'Status\n1 - item técnico',
    );
  });

  it('deve converter listas com bullets em opções numeradas', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              'Encontrei suas solicitações:\n• SC-00001 — Pendente\n• SC-00002 — Em análise',
            tool_calls: null,
          },
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: 'listar solicitações',
      messageSid: 'SM3B',
      mediaUrl: null,
    });

    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      'Encontrei suas solicitações:\n1 - SC-00001 — Pendente\n2 - SC-00002 — Em análise',
    );
  });

  it('deve identificar usuário quando telefone estiver salvo formatado', async () => {
    userRepositoryMock.findOneByPhone.mockImplementation(
      async (phone: string) => {
        if (phone === '(31) 98908-5791') {
          return {
            id: 'user-1',
            aiConsentAcceptedAt: new Date('2026-01-01'),
          };
        }
        return null;
      },
    );

    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Tudo certo.', tool_calls: null } }],
    });

    await service.processMessage({
      from: 'whatsapp:+5531989085791',
      body: 'minhas solicitações',
      messageSid: 'SM4',
      mediaUrl: null,
    });

    expect(accessControlMock.getAccessibleDoctorIds).toHaveBeenCalledWith(
      'user-1',
    );
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5531989085791',
      'Tudo certo.',
    );
  });

  it('deve identificar usuário mesmo quando inbound vier sem nono dígito', async () => {
    userRepositoryMock.findOneByPhone.mockImplementation(
      async (phone: string) => {
        if (phone === '(31) 98908-5791') {
          return {
            id: 'user-1',
            aiConsentAcceptedAt: new Date('2026-01-01'),
          };
        }
        return null;
      },
    );

    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Encontrei suas solicitações.',
            tool_calls: null,
          },
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+553189085791',
      body: 'minhas solicitações',
      messageSid: 'SM5',
      mediaUrl: null,
    });

    expect(accessControlMock.getAccessibleDoctorIds).toHaveBeenCalledWith(
      'user-1',
    );
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+553189085791',
      'Encontrei suas solicitações.',
    );
  });

  it('deve remover emojis e markdown inline da resposta final', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '📋 *Solicitação SC-664980*\nStatus: Em análise ✅',
            tool_calls: null,
          },
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511888888888',
      body: 'detalhes da sc-664980',
      messageSid: 'SM6',
      mediaUrl: null,
    });

    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      'Solicitação SC-664980\nStatus: Em análise',
    );
  });

  it('deve remover todos os emojis da resposta final (política zero-emoji)', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '✅ Pronto 🎉🎊🚀🥳 obrigado!',
            tool_calls: null,
          },
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511777777777',
      body: 'obrigado',
      messageSid: 'SM6B',
      mediaUrl: null,
    });

    const sentText = whatsappServiceMock.sendMessage.mock.calls[0][1] as string;
    const emojiCount = (sentText.match(/[\p{Extended_Pictographic}]/gu) || [])
      .length;
    expect(emojiCount).toBe(0);
    expect(sentText).toContain('Pronto');
    expect(sentText).toContain('obrigado!');
  });

  it('deve enriquecer resultado de mutação com próximo passo recomendado', async () => {
    const toolCall: OpenAI.ChatCompletionMessageToolCall = {
      id: 'call-next',
      type: 'function',
      function: {
        name: 'confirm_receipt',
        arguments: JSON.stringify({
          surgeryRequestId: 'req-1',
          confirm: true,
        }),
      },
    };

    openaiServiceMock.chatCompletion
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall] } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Ação concluída.',
              tool_calls: null,
            },
          },
        ],
      });

    toolExecutorMock.executeMany.mockResolvedValue([
      {
        toolCallId: 'call-next',
        output: 'Recebimento confirmado na solicitação SC-0042.',
      },
    ]);

    pendencyValidatorMock.validateForStatus.mockResolvedValue({
      pendencies: [
        {
          key: 'patient_data',
          name: 'Dados do Paciente',
          isComplete: false,
          isOptional: false,
        },
      ],
    });

    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'confirmar recebimento',
      messageSid: 'SM7',
      mediaUrl: null,
    });

    const secondCallArgs = openaiServiceMock.chatCompletion.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m: any) => m.role === 'tool',
    );

    expect(toolMessage.content).toContain('Próximo passo recomendado');
    expect(toolMessage.content).toContain('update_sc_draft');
  });

  it('deve pedir confirmação antes de limpar contexto', async () => {
    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'limpar contexto',
      messageSid: 'SM8',
      mediaUrl: null,
    });

    expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
    expect(conversationServiceMock.appendMessage).not.toHaveBeenCalled();
    expect(
      conversationServiceMock.resetConversationHistory,
    ).not.toHaveBeenCalled();
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511999999999',
      'Confirma que deseja limpar o contexto desta conversa? As próximas mensagens serão tratadas sem histórico anterior. Responda "sim" para confirmar ou "não" para cancelar.',
    );
  });

  it('deve limpar o contexto quando receber confirmação', async () => {
    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'sair da conversa',
      messageSid: 'SM9',
      mediaUrl: null,
    });

    jest.clearAllMocks();

    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'sim',
      messageSid: 'SM10',
      mediaUrl: null,
    });

    expect(
      conversationServiceMock.resetConversationHistory,
    ).toHaveBeenCalledWith('conv-1');
    expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511999999999',
      'Pronto. Limpei o contexto desta conversa. Precisa de mais alguma coisa? Se precisar, é só chamar.',
    );
  });

  it('não deve limpar contexto com comando isolado "sair"', async () => {
    openaiServiceMock.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Entendido.', tool_calls: null } }],
    });

    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'sair',
      messageSid: 'SM10A',
      mediaUrl: null,
    });

    expect(
      conversationServiceMock.resetConversationHistory,
    ).not.toHaveBeenCalled();
    expect(openaiServiceMock.chatCompletion).toHaveBeenCalled();
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511999999999',
      'Entendido.',
    );
  });

  describe('Pseudonimização de PII (Fase 0)', () => {
    it('limpa placeholders alucinados pela IA quando não há binding correspondente no vault', async () => {
      // Cenário do print do bug: a IA escreveu "{{protocol_1}}" sem que esse
      // placeholder tivesse sido tokenizado pela tool no turno atual (nem
      // restaurado de turnos anteriores). Antes da limpeza defensiva, o
      // usuário recebia o placeholder cru no WhatsApp.
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'Não consegui localizar a solicitação com o protocolo {{protocol_1}}.',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'solicitação 1',
        messageSid: 'SM-PII-LEAK',
        mediaUrl: null,
      });

      const sentToWhatsapp = (
        whatsappServiceMock.sendMessage as jest.Mock
      ).mock.calls.at(-1)?.[1] as string;
      expect(sentToWhatsapp).not.toMatch(/\{\{[a-z_]+_\d+\}\}/i);
      expect(sentToWhatsapp).toContain('essa solicitação');
    });

    it('tokeniza CPF do input antes de enviar à OpenAI e detokeniza no WhatsApp', async () => {
      const capturedHistory: any[] = [];
      conversationServiceMock.appendMessage.mockImplementation(
        async (_id: string, role: string, content: string) => {
          capturedHistory.push({ role, content });
          (
            conversationServiceMock.getOrCreateConversation as jest.Mock
          ).mockResolvedValueOnce({
            id: 'conv-1',
            phone: '+5511999999999',
            userId: 'user-1',
            messagesHistory: capturedHistory,
          });
        },
      );

      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Confirmei o CPF {{cpf_1}} para o seu cadastro.',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'meu CPF é 123.456.789-00',
        messageSid: 'SM-PII-1',
        mediaUrl: null,
      });

      const callArgs = openaiServiceMock.chatCompletion.mock.calls[0][0];
      const userMessageSentToOpenAi = callArgs.messages.find(
        (m: any) => m.role === 'user',
      );
      expect(userMessageSentToOpenAi.content).not.toContain('123.456.789-00');
      expect(userMessageSentToOpenAi.content).toContain('{{cpf_1}}');

      const sentToWhatsapp = (whatsappServiceMock.sendMessage as jest.Mock).mock
        .calls[0][1];
      expect(sentToWhatsapp).toContain('123.456.789-00');
      expect(sentToWhatsapp).not.toContain('{{cpf_1}}');
    });

    it('redige PII residual in-place antes de chamar a OpenAI sem incomodar o usuário', async () => {
      defaultContextServiceMock.buildContext.mockResolvedValueOnce({
        messages: [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'CPF: 123.456.789-00' },
        ],
        breakdown: {
          system_tokens: 5,
          summary_tokens: 0,
          memory_tokens: 0,
          rag_tokens: 0,
          recent_tokens: 5,
          totalTokens: 10,
        },
        strategy: 'hybrid',
        recentCount: 1,
      });
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Tudo certo, prossigo com o cadastro.',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'consulta normal',
        messageSid: 'SM-PII-REDACT',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).toHaveBeenCalled();
      const callArgs = openaiServiceMock.chatCompletion.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: any) => m.role === 'user' && (m.content as string).includes('CPF'),
      );
      expect(userMessage.content).not.toContain('123.456.789-00');
      expect(userMessage.content).toContain('XXX.XXX.XXX-XX');

      expect(piiRedactionLogRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          messageSid: 'SM-PII-REDACT',
          category: 'cpf',
          blocked: false,
        }),
      );

      const sentMessages = (
        whatsappServiceMock.sendMessage as jest.Mock
      ).mock.calls.map((call) => call[1]);
      for (const sent of sentMessages) {
        expect(sent).not.toContain('dado sensível');
      }
    });

    it('persiste bindings do vault entre turnos para evitar placeholders órfãos no WhatsApp', async () => {
      // Reproduz o bug: turno 1 tokeniza protocols/patient_names, salva no
      // histórico; turno 2 reaproveita placeholders mas a sessão do vault é
      // nova. Sem persistência de bindings, o detokenize devolveria texto
      // com `{{protocol_1}}` cru (exatamente o que o usuário viu).
      const piiVaultStore = new PiiVaultService();
      service = new AiOrchestratorService(
        openaiServiceMock as any,
        conversationServiceMock as any,
        toolRegistryMock as any,
        toolExecutorMock as any,
        ragServiceMock as any,
        whatsappServiceMock as any,
        userRepositoryMock as any,
        accessControlMock as any,
        configServiceMock as any,
        whatsappMediaServiceMock as any,
        piiVaultStore,
        piiRedactionLogRepoMock as any,
        aiRedisMock as any,
        defaultContextServiceMock as any,
        whatsappConversationRepoMock as any,
        new ResponseNormalizerService(),
        new PhoneNormalizerService(userRepositoryMock as any),
        new ClearContextDetectorService(),
        new ConfirmationManagerService(
          whatsappConversationRepoMock as any,
          conversationServiceMock as any,
        ),
        new OrchestratorTelemetryService(
          aiTokenUsageLogRepoMock as any,
          new PhoneNormalizerService(userRepositoryMock as any),
          {
            categoryCounts: jest.fn().mockReturnValue({}),
          } as unknown as PiiVaultService,
        ),
        new ToolLoopRunnerService(
          openaiServiceMock as any,
          toolExecutorMock as any,
          new ConfirmationManagerService(
            whatsappConversationRepoMock as any,
            conversationServiceMock as any,
          ),
          new OrchestratorTelemetryService(
            aiTokenUsageLogRepoMock as any,
            new PhoneNormalizerService(userRepositoryMock as any),
            {
              categoryCounts: jest.fn().mockReturnValue({}),
            } as unknown as PiiVaultService,
          ),
        ),
        new MessageProcessorService(
          queueMock as any,
          configServiceMock as any,
          aiRedisMock as any,
          whatsappServiceMock as any,
          openaiServiceMock as any,
          ragServiceMock as any,
          piiVault as any,
          new PhoneNormalizerService(userRepositoryMock as any),
          new ResponseNormalizerService(),
        ),
        documentIntakeMock as any,
        new AudioIntakeService(
          whatsappMediaServiceMock as any,
          transcriptionServiceMock as any,
          configServiceMock as any,
        ),
        new PiiBindingService(
          piiVaultStore,
          aiRedisMock as any,
          piiRedactionLogRepoMock as any,
        ),
        {
          memorizeEntities: jest.fn().mockResolvedValue(undefined),
          resolveDoctorsInfo: jest.fn().mockResolvedValue([]),
          readMemory: jest.fn().mockResolvedValue(null),
          patchMemory: jest.fn().mockResolvedValue(undefined),
        } as unknown as ConversationMemoryService,
        nextStepAdvisorService,
        draftContextMock as any,
      );

      const tool: OpenAI.ChatCompletionMessageToolCall = {
        id: 'call-list',
        type: 'function',
        function: {
          name: 'query_surgery_requests',
          arguments: JSON.stringify({}),
        },
      };

      // Turno 1: tool tokeniza diretamente no vault (como em produção) e o
      // LLM responde reaproveitando os placeholders. As tools reais
      // armazenam o protocol SEM prefixo "SC-" no vault e prefixam "SC-"
      // FORA do placeholder no output (regressão SC-SC-).
      toolExecutorMock.executeMany.mockImplementationOnce(
        async (_calls: any[], context: any) => {
          context.piiVault.tokenize(context.conversationId, '0042', 'protocol');
          context.piiVault.tokenize(
            context.conversationId,
            'João Silva',
            'patient_name',
          );
          return [
            {
              toolCallId: 'call-list',
              output: '• SC-{{protocol_1}} — {{patient_name_1}} — Finalizada',
            },
          ];
        },
      );

      openaiServiceMock.chatCompletion
        .mockResolvedValueOnce({
          choices: [{ message: { content: null, tool_calls: [tool] } }],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content:
                  'Encontrei: 1 - SC-{{protocol_1}} — {{patient_name_1}} — Finalizada',
                tool_calls: null,
              },
            },
          ],
        });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'minhas solicitações',
        messageSid: 'SM-PERSIST-1',
        mediaUrl: null,
      });

      const turn1Sent = (
        whatsappServiceMock.sendMessage as jest.Mock
      ).mock.calls.at(-1)?.[1] as string;
      expect(turn1Sent).toContain('SC-0042');
      expect(turn1Sent).toContain('João Silva');
      expect(turn1Sent).not.toContain('{{protocol_1}}');

      jest.clearAllMocks();
      // Reapaga o cooldown e re-injeta o usuário com consent válido.
      userRepositoryMock.findOneByPhone.mockResolvedValue({
        id: 'user-1',
        aiConsentAcceptedAt: new Date('2026-01-01T00:00:00Z'),
      });
      accessControlMock.getAccessibleDoctorIds.mockResolvedValue(['doctor-1']);
      conversationServiceMock.getOrCreateConversation.mockResolvedValue({
        id: 'conv-1',
        phone: '+5511999999999',
        userId: 'user-1',
        messagesHistory: [],
      });

      // Turno 2: LLM responde DIRETO citando os placeholders do histórico,
      // sem chamar tool (cenário real do bug).
      openaiServiceMock.chatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                'A SC mais recente é SC-{{protocol_1}} do paciente {{patient_name_1}}.',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'qual a sc mais recente?',
        messageSid: 'SM-PERSIST-2',
        mediaUrl: null,
      });

      const turn2Sent = (
        whatsappServiceMock.sendMessage as jest.Mock
      ).mock.calls.at(-1)?.[1] as string;
      expect(turn2Sent).toContain('SC-0042');
      expect(turn2Sent).toContain('João Silva');
      expect(turn2Sent).not.toContain('{{protocol_1}}');
      expect(turn2Sent).not.toContain('{{patient_name_1}}');
    });

    it('persiste bindings via Redis quando disponível', async () => {
      const piiVaultStore = new PiiVaultService();
      const redisStore = new Map<string, any>();
      const redisAvailableMock = {
        ...aiRedisMock,
        isAvailable: true,
        cacheGet: jest.fn(async (key: string) => redisStore.get(key) ?? null),
        cacheSet: jest.fn(async (key: string, value: any) => {
          redisStore.set(key, value);
        }),
        cacheDelete: jest.fn(async (key: string) => {
          redisStore.delete(key);
        }),
      };

      service = new AiOrchestratorService(
        openaiServiceMock as any,
        conversationServiceMock as any,
        toolRegistryMock as any,
        toolExecutorMock as any,
        ragServiceMock as any,
        whatsappServiceMock as any,
        userRepositoryMock as any,
        accessControlMock as any,
        configServiceMock as any,
        whatsappMediaServiceMock as any,
        piiVaultStore,
        piiRedactionLogRepoMock as any,
        redisAvailableMock as any,
        defaultContextServiceMock as any,
        whatsappConversationRepoMock as any,
        new ResponseNormalizerService(),
        new PhoneNormalizerService(userRepositoryMock as any),
        new ClearContextDetectorService(),
        new ConfirmationManagerService(
          whatsappConversationRepoMock as any,
          conversationServiceMock as any,
        ),
        new OrchestratorTelemetryService(
          aiTokenUsageLogRepoMock as any,
          new PhoneNormalizerService(userRepositoryMock as any),
          {
            categoryCounts: jest.fn().mockReturnValue({}),
          } as unknown as PiiVaultService,
        ),
        new ToolLoopRunnerService(
          openaiServiceMock as any,
          toolExecutorMock as any,
          new ConfirmationManagerService(
            whatsappConversationRepoMock as any,
            conversationServiceMock as any,
          ),
          new OrchestratorTelemetryService(
            aiTokenUsageLogRepoMock as any,
            new PhoneNormalizerService(userRepositoryMock as any),
            {
              categoryCounts: jest.fn().mockReturnValue({}),
            } as unknown as PiiVaultService,
          ),
        ),
        new MessageProcessorService(
          queueMock as any,
          configServiceMock as any,
          aiRedisMock as any,
          whatsappServiceMock as any,
          openaiServiceMock as any,
          ragServiceMock as any,
          piiVault as any,
          new PhoneNormalizerService(userRepositoryMock as any),
          new ResponseNormalizerService(),
        ),
        documentIntakeMock as any,
        new AudioIntakeService(
          whatsappMediaServiceMock as any,
          transcriptionServiceMock as any,
          configServiceMock as any,
        ),
        new PiiBindingService(
          piiVaultStore,
          redisAvailableMock as any,
          piiRedactionLogRepoMock as any,
        ),
        {
          memorizeEntities: jest.fn().mockResolvedValue(undefined),
          resolveDoctorsInfo: jest.fn().mockResolvedValue([]),
          readMemory: jest.fn().mockResolvedValue(null),
          patchMemory: jest.fn().mockResolvedValue(undefined),
        } as unknown as ConversationMemoryService,
        nextStepAdvisorService,
        draftContextMock as any,
      );

      const tool: OpenAI.ChatCompletionMessageToolCall = {
        id: 'call-list',
        type: 'function',
        function: {
          name: 'query_surgery_requests',
          arguments: JSON.stringify({}),
        },
      };

      toolExecutorMock.executeMany.mockImplementationOnce(
        async (_calls: any[], context: any) => {
          context.piiVault.tokenize(
            context.conversationId,
            'SC-9999',
            'protocol',
          );
          return [{ toolCallId: 'call-list', output: '• {{protocol_1}}' }];
        },
      );

      openaiServiceMock.chatCompletion
        .mockResolvedValueOnce({
          choices: [{ message: { content: null, tool_calls: [tool] } }],
        })
        .mockResolvedValueOnce({
          choices: [
            { message: { content: '1 - {{protocol_1}}', tool_calls: null } },
          ],
        });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'minhas solicitações',
        messageSid: 'SM-REDIS-1',
        mediaUrl: null,
      });

      // Note: o vault normaliza realValue de protocol removendo SC-
      // (regressão SC-SC-): mesmo que a tool passe "SC-9999", grava "9999".
      expect(redisAvailableMock.cacheSet).toHaveBeenCalledWith(
        expect.stringContaining('pii:vault:conv-1'),
        expect.arrayContaining([
          expect.objectContaining({
            token: '{{protocol_1}}',
            category: 'protocol',
            realValue: '9999',
          }),
        ]),
        expect.any(Number),
      );
    });

    // Regressão: print 2026-05-10 — usuário recebia "SC-SC-468131" no
    // WhatsApp porque a IA, ao copiar o padrão "SC-{{protocol_n}}" do
    // contexto, prefixava MAIS um "SC-" por engano. Defesa: o orchestrator
    // colapsa "SC-SC-XXX" em "SC-XXX" antes de enviar e antes de gravar no
    // histórico, garantindo que o erro nunca chegue ao usuário e nem se
    // propague nos turnos seguintes.
    it('colapsa "SC-SC-XXXX" para "SC-XXXX" antes de enviar a resposta ao WhatsApp', async () => {
      const tool: OpenAI.ChatCompletionMessageToolCall = {
        id: 'call-list',
        type: 'function',
        function: {
          name: 'query_surgery_requests',
          arguments: JSON.stringify({}),
        },
      };

      toolExecutorMock.executeMany.mockImplementationOnce(
        async (_calls: any[], context: any) => {
          context.piiVault.tokenize(
            context.conversationId,
            '468131',
            'protocol',
          );
          return [{ toolCallId: 'call-list', output: '• SC-{{protocol_1}}' }];
        },
      );

      // IA alucina prefixo duplicado ao referenciar a SC.
      openaiServiceMock.chatCompletion
        .mockResolvedValueOnce({
          choices: [{ message: { content: null, tool_calls: [tool] } }],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: 'A solicitação SC-SC-{{protocol_1}} está pendente.',
                tool_calls: null,
              },
            },
          ],
        });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'qual a sc 1?',
        messageSid: 'SM-DUP-SC-1',
        mediaUrl: null,
      });

      const sentText = (
        whatsappServiceMock.sendMessage as jest.Mock
      ).mock.calls.at(-1)?.[1] as string;
      expect(sentText).toContain('SC-468131');
      expect(sentText).not.toContain('SC-SC-468131');
      expect(sentText).not.toContain('SC-SC-');

      // Histórico também é saneado para impedir que o erro se propague.
      const historyAppendCall = (
        conversationServiceMock.appendMessage as jest.Mock
      ).mock.calls.find((call) => call[1] === 'assistant');
      expect(historyAppendCall?.[2]).not.toContain('SC-SC-');
    });

    it('não bloqueia turno seguinte quando assistant histórico contém exemplo de telefone (regressão print 2026-05-09)', async () => {
      // Reproduz o cenário do print: o assistant escreveu literalmente
      // "ex: 31 99999-9999" em uma resposta anterior; antes da correção,
      // `assertNoResidualPii` detectava esse texto no histórico e bloqueava
      // todos os turnos seguintes com a notice "Detectei um dado sensível...".
      defaultContextServiceMock.buildContext.mockResolvedValueOnce({
        messages: [
          { role: 'system', content: 'system' },
          {
            role: 'assistant',
            content:
              'Forneça os dados no formato: 1 - Telefone (ex: 31 99999-9999) 2 - CPF (somente dígitos).',
          },
          { role: 'user', content: 'pode prosseguir' },
        ],
        breakdown: {
          system_tokens: 5,
          summary_tokens: 0,
          memory_tokens: 0,
          rag_tokens: 0,
          recent_tokens: 5,
          totalTokens: 10,
        },
        strategy: 'hybrid',
        recentCount: 2,
      });
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Confirmado, pode prosseguir.',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'pode prosseguir',
        messageSid: 'SM-PII-ASSISTANT-EXAMPLE',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).toHaveBeenCalled();
      expect(piiRedactionLogRepoMock.create).not.toHaveBeenCalled();
      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        'Confirmado, pode prosseguir.',
      );
    });

    it('sanitiza CPF/telefone literais em respostas do assistant antes de salvar no histórico', async () => {
      const captured: any[] = [];
      conversationServiceMock.appendMessage.mockImplementation(
        async (_id: string, role: string, content: string) => {
          captured.push({ role, content });
        },
      );

      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'Forneça os dados no formato: telefone (ex: 31 99999-9999) e CPF 123.456.789-00.',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'criar paciente',
        messageSid: 'SM-PII-ASSIST-MASK',
        mediaUrl: null,
      });

      const assistantSaved = captured.find((m) => m.role === 'assistant');
      expect(assistantSaved).toBeDefined();
      expect(assistantSaved.content).not.toContain('31 99999-9999');
      expect(assistantSaved.content).not.toContain('123.456.789-00');
      expect(assistantSaved.content).toContain('(DDD) NNNNN-NNNN');
      expect(assistantSaved.content).toContain('XXX.XXX.XXX-XX');
    });

    it('não dispara notice de PII por causa do telefone do usuário no contexto (regressão)', async () => {
      // Reproduz o bloco real produzido por ConversationContextService.buildContext:
      // antes da correção, "Telefone=+5511999999999" era detectado como PII residual
      // e qualquer mensagem (até "olá") respondia com a notice "Detectei um dado sensível".
      defaultContextServiceMock.buildContext.mockResolvedValueOnce({
        messages: [
          { role: 'system', content: 'system' },
          {
            role: 'system',
            content: 'USUÁRIO ATUAL: ID=user-1, Telefone={{phone_1}}',
          },
          { role: 'user', content: 'olá' },
        ],
        breakdown: {
          system_tokens: 5,
          summary_tokens: 0,
          memory_tokens: 0,
          rag_tokens: 0,
          recent_tokens: 5,
          totalTokens: 10,
        },
        strategy: 'hybrid',
        recentCount: 1,
      });
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          { message: { content: 'Olá, como posso ajudar?', tool_calls: null } },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'olá',
        messageSid: 'SM-PII-USER-PHONE',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).toHaveBeenCalled();
      expect(piiRedactionLogRepoMock.create).not.toHaveBeenCalled();
      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        'Olá, como posso ajudar?',
      );
    });
  });

  describe('Consentimento de IA (T0.15)', () => {
    it('bloqueia processamento e envia mensagem padrão quando aiConsentAcceptedAt está ausente', async () => {
      userRepositoryMock.findOneByPhone.mockResolvedValue({
        id: 'user-no-consent',
        aiConsentAcceptedAt: null,
      });

      await service.processMessage({
        from: 'whatsapp:+5511988887777',
        body: 'oi',
        messageSid: 'SM-CONSENT-1',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
      expect(
        conversationServiceMock.getOrCreateConversation,
      ).not.toHaveBeenCalled();
      const sentBody = (whatsappServiceMock.sendMessage as jest.Mock).mock
        .calls[0][1] as string;
      expect(sentBody).toContain('assistente');
      expect(sentBody).toContain('configuracoes/privacidade');
    });

    it('não envia a mensagem novamente dentro do cooldown para o mesmo telefone', async () => {
      userRepositoryMock.findOneByPhone.mockResolvedValue({
        id: 'user-no-consent',
        aiConsentAcceptedAt: null,
      });

      await service.processMessage({
        from: 'whatsapp:+5511966665555',
        body: 'oi',
        messageSid: 'SM-CONSENT-3',
        mediaUrl: null,
      });
      await service.processMessage({
        from: 'whatsapp:+5511966665555',
        body: 'oi de novo',
        messageSid: 'SM-CONSENT-4',
        mediaUrl: null,
      });

      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('processa normalmente quando consentimento está válido', async () => {
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'OK', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511955554444',
        body: 'oi',
        messageSid: 'SM-CONSENT-OK',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).toHaveBeenCalled();
    });

    it('responde via RAG (modo limitado) quando sem consent e a mensagem é uma dúvida sobre a Inexci', async () => {
      userRepositoryMock.findOneByPhone.mockResolvedValue({
        id: 'user-no-consent',
        aiConsentAcceptedAt: null,
      });
      ragServiceMock.search.mockResolvedValue([
        {
          id: 'k1',
          content: 'Para criar uma SC, vá ao menu...',
          category: 'faq',
        },
      ]);
      ragServiceMock.formatContext.mockResolvedValue(
        '[1] Para criar uma SC, vá ao menu...',
      );
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'Para criar uma SC, acesse o menu Solicitações e clique em "Nova".',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511944443333',
        body: 'como crio uma solicitação cirúrgica?',
        messageSid: 'SM-FAQ-1',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).toHaveBeenCalled();
      expect(openaiServiceMock.chatCompletion).toHaveBeenCalledTimes(1);
      const completionArgs = openaiServiceMock.chatCompletion.mock.calls[0][0];
      // Modo limitado não envia tools
      expect(completionArgs.tools).toBeUndefined();
      const sentBody = (whatsappServiceMock.sendMessage as jest.Mock).mock
        .calls[0][1] as string;
      expect(sentBody).toContain('Solicitações');
      // Não enviou a notice de consent
      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('não tenta o modo limitado quando a mensagem contém PII (CPF, telefone, e-mail)', async () => {
      userRepositoryMock.findOneByPhone.mockResolvedValue({
        id: 'user-no-consent',
        aiConsentAcceptedAt: null,
      });

      await service.processMessage({
        from: 'whatsapp:+5511933332222',
        body: 'Meu CPF é 123.456.789-00, podem me ajudar?',
        messageSid: 'SM-FAQ-PII',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
      expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
      const sentBody = (whatsappServiceMock.sendMessage as jest.Mock).mock
        .calls[0][1] as string;
      expect(sentBody).toContain('configuracoes/privacidade');
    });

    it('cai para a notice quando RAG não encontra contexto relevante', async () => {
      userRepositoryMock.findOneByPhone.mockResolvedValue({
        id: 'user-no-consent',
        aiConsentAcceptedAt: null,
      });
      ragServiceMock.search.mockResolvedValue([]);

      await service.processMessage({
        from: 'whatsapp:+5511922221111',
        body: 'pergunta totalmente fora do escopo da inexci',
        messageSid: 'SM-FAQ-MISS',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
      const sentBody = (whatsappServiceMock.sendMessage as jest.Mock).mock
        .calls[0][1] as string;
      expect(sentBody).toContain('configuracoes/privacidade');
    });
  });

  it('deve manter aguardando confirmação quando receber texto diferente', async () => {
    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'limpar histórico',
      messageSid: 'SM11',
      mediaUrl: null,
    });

    jest.clearAllMocks();

    await service.processMessage({
      from: 'whatsapp:+5511999999999',
      body: 'ok',
      messageSid: 'SM12',
      mediaUrl: null,
    });

    expect(
      conversationServiceMock.resetConversationHistory,
    ).not.toHaveBeenCalled();
    expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511999999999',
      'Ainda estou aguardando sua confirmação para limpar o contexto. Responda "sim" para confirmar ou "não" para cancelar.',
    );
  });

  // describe('Plano Tokens (Fase 4) — slot-filling') removido em 2026-05-12
  // (Fase 3.1 do PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA). O slot-filling
  // determinístico saiu do orchestrator junto com a tool legacy
  // `create_surgery_request_from_whatsapp`. A validação de campos
  // obrigatórios da criação de SC agora vive dentro do fluxo `sc_draft_*`
  // (coberto por `sc-draft.tools.spec.ts`).

  describe('Resposta numérica determinística', () => {
    /**
     * Captura a lista de mensagens enviada ao OpenAI na PRIMEIRA chamada
     * dentro do turno atual. Útil para conferir o conteúdo do system hint
     * de interpretação numérica.
     */
    const firstMessagesSentToOpenAi = (): any[] => {
      const call = openaiServiceMock.chatCompletion.mock.calls.at(0);
      return (call?.[0]?.messages || []) as any[];
    };

    it('quando o usuário responde "2" e a última mensagem tinha opções numeradas, injeta system hint mapeando para a opção 2', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        {
          role: 'assistant',
          content: [
            'Aqui estão suas solicitações cirúrgicas:',
            'Pendente: SC-405355 — Patrícia',
            'Enviada: SC-549841 — Eduardo',
            '',
            'O que você gostaria de fazer agora?',
            '1 - Ver detalhes de uma SC (me diga o protocolo)',
            '2 - Ver pendências de uma SC',
            '3 - Criar uma nova SC',
          ].join('\n'),
        },
        { role: 'user', content: '2' },
      ]);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Claro — qual o protocolo?',
              tool_calls: null,
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: '2',
        messageSid: 'SM-NUM-1',
        mediaUrl: null,
      });

      const messages = firstMessagesSentToOpenAi();
      const hint = messages.find(
        (m: any) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('INTERPRETAÇÃO DETERMINÍSTICA'),
      );
      expect(hint).toBeDefined();
      expect(hint.content).toContain('OPÇÃO 2');
      expect(hint.content).toContain('Ver pendências de uma SC');
      expect(hint.content).toMatch(/PROIBIDO/);
    });

    it('aceita variações curtas como "opcao 3" e mapeia para a opção 3', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        {
          role: 'assistant',
          content: [
            'Posso ajudar com:',
            '1 - Ver SC',
            '2 - Ver pendências',
            '3 - Criar nova SC',
          ].join('\n'),
        },
      ]);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'Vamos criar', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'opção 3',
        messageSid: 'SM-NUM-2',
        mediaUrl: null,
      });

      const messages = firstMessagesSentToOpenAi();
      const hint = messages.find(
        (m: any) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('INTERPRETAÇÃO DETERMINÍSTICA'),
      );
      expect(hint).toBeDefined();
      expect(hint.content).toContain('OPÇÃO 3');
      expect(hint.content).toContain('Criar nova SC');
    });

    it('quando dígito não existe na lista, injeta hint pedindo para mostrar opções de novo', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        {
          role: 'assistant',
          content: [
            'Posso ajudar com:',
            '1 - Ver SC',
            '2 - Ver pendências',
          ].join('\n'),
        },
      ]);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'Ops, repito', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: '5',
        messageSid: 'SM-NUM-3',
        mediaUrl: null,
      });

      const messages = firstMessagesSentToOpenAi();
      const hint = messages.find(
        (m: any) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('INTERPRETAÇÃO DETERMINÍSTICA'),
      );
      expect(hint).toBeDefined();
      expect(hint.content).toMatch(/1\/2/);
      expect(hint.content).toMatch(/mostre as op[çc][õo]es novamente/i);
    });

    it('NÃO injeta hint quando a última mensagem do assistente não tem opções numeradas', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        {
          role: 'assistant',
          content: 'Olá, em que posso ajudar?',
        },
      ]);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'Resposta', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: '2',
        messageSid: 'SM-NUM-4',
        mediaUrl: null,
      });

      const messages = firstMessagesSentToOpenAi();
      const hint = messages.find(
        (m: any) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('INTERPRETAÇÃO DETERMINÍSTICA'),
      );
      expect(hint).toBeUndefined();
    });

    it('NÃO injeta hint quando o usuário escreve uma frase longa (não é escolha numérica)', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        {
          role: 'assistant',
          content: '1 - Ver SC\n2 - Criar nova SC',
        },
      ]);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'Resposta', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'quero criar uma nova solicitação para a Beatriz',
        messageSid: 'SM-NUM-5',
        mediaUrl: null,
      });

      const messages = firstMessagesSentToOpenAi();
      const hint = messages.find(
        (m: any) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('INTERPRETAÇÃO DETERMINÍSTICA'),
      );
      expect(hint).toBeUndefined();
    });
  });

  describe('Rate limit (janela curta configurável)', () => {
    it('usa Redis quando disponível e respeita AI_RATELIMIT_MAX/AI_RATELIMIT_WINDOW_SEC', async () => {
      configServiceMock.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'AI_PROCESS_TIMEOUT_MS') return 90000;
          if (key === 'AI_AUDIO_ENABLED') return 'true';
          if (key === 'AI_RATELIMIT_MAX') return 7;
          if (key === 'AI_RATELIMIT_WINDOW_SEC') return 42;
          return defaultValue;
        },
      );
      (aiRedisMock as any).isAvailable = true;
      aiRedisMock.checkRateLimit.mockResolvedValueOnce(true);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'ok', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511777776666',
        body: 'oi',
        messageSid: 'SM-RL-1',
        mediaUrl: null,
      });

      expect(aiRedisMock.checkRateLimit).toHaveBeenCalledWith(
        '+5511777776666',
        7,
        42,
      );
      (aiRedisMock as any).isAvailable = false;
    });

    it('bloqueia e responde com aviso quando excede o limite (fallback in-memory)', async () => {
      configServiceMock.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'AI_PROCESS_TIMEOUT_MS') return 90000;
          if (key === 'AI_AUDIO_ENABLED') return 'true';
          if (key === 'AI_RATELIMIT_MAX') return 2;
          if (key === 'AI_RATELIMIT_WINDOW_SEC') return 60;
          return defaultValue;
        },
      );
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'ok', tool_calls: null } }],
      });

      const phone = '+5511666665555';
      await service.processMessage({
        from: `whatsapp:${phone}`,
        body: 'msg 1',
        messageSid: 'SM-RL-A',
        mediaUrl: null,
      });
      await service.processMessage({
        from: `whatsapp:${phone}`,
        body: 'msg 2',
        messageSid: 'SM-RL-B',
        mediaUrl: null,
      });

      const sendCallsBefore = (whatsappServiceMock.sendMessage as jest.Mock)
        .mock.calls.length;
      const openaiCallsBefore = (openaiServiceMock.chatCompletion as jest.Mock)
        .mock.calls.length;

      await service.processMessage({
        from: `whatsapp:${phone}`,
        body: 'msg 3 (deve bloquear)',
        messageSid: 'SM-RL-C',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).toHaveBeenCalledTimes(
        openaiCallsBefore,
      );
      const blockCall = (whatsappServiceMock.sendMessage as jest.Mock).mock
        .calls[sendCallsBefore];
      expect(blockCall[0]).toBe(phone);
      expect(blockCall[1]).toContain('ritmo muito alto');
      expect(blockCall[1]).toContain('aguarde alguns instantes');
    });

    it('aplica defaults (20/60s) quando envs não estão definidas', async () => {
      (aiRedisMock as any).isAvailable = true;
      aiRedisMock.checkRateLimit.mockResolvedValueOnce(true);
      openaiServiceMock.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'ok', tool_calls: null } }],
      });

      await service.processMessage({
        from: 'whatsapp:+5511555554444',
        body: 'oi',
        messageSid: 'SM-RL-DEF',
        mediaUrl: null,
      });

      expect(aiRedisMock.checkRateLimit).toHaveBeenCalledWith(
        '+5511555554444',
        20,
        60,
      );
      (aiRedisMock as any).isAvailable = false;
    });
  });

  // ============================================================
  // Fase 5 — MAX_TOOL_ITERATIONS (loop limit)
  // ============================================================
  describe('loop limit (MAX_TOOL_ITERATIONS = 5)', () => {
    const persistentToolCall: OpenAI.ChatCompletionMessageToolCall = {
      id: 'call-loop',
      type: 'function',
      function: {
        name: 'advance_surgery_request',
        arguments: JSON.stringify({ surgeryRequestId: 'req-1' }),
      },
    };
    const loopResponse = {
      choices: [
        { message: { content: null, tool_calls: [persistentToolCall] } },
      ],
    };

    it('loga [AI_LOOP_LIMIT] e envia mensagem amigável quando esgota iterações', async () => {
      // Sempre devolve tool_calls → o loop esgota independente do número de
      // iterações (initial + 5 followups). `mockResolvedValue` (sem `Once`)
      // cobre todas as chamadas.
      openaiServiceMock.chatCompletion.mockResolvedValue(loopResponse);

      toolExecutorMock.executeMany.mockResolvedValue([
        { toolCallId: 'call-loop', output: 'ok' },
      ]);

      const warnSpy = jest.spyOn(
        (service as any).toolLoopRunner.logger,
        'warn',
      );

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'teste loop',
        messageSid: 'SM-LOOP',
        mediaUrl: null,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AI_LOOP_LIMIT]'),
      );
      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('Vou parar por aqui'),
      );

      warnSpy.mockRestore();
    });

    it('NÃO loga [AI_LOOP_LIMIT] quando o loop termina normalmente antes do limite', async () => {
      openaiServiceMock.chatCompletion
        .mockResolvedValueOnce({
          choices: [
            { message: { content: null, tool_calls: [persistentToolCall] } },
          ],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Pronto.', tool_calls: null } }],
        });

      toolExecutorMock.executeMany.mockResolvedValue([
        { toolCallId: 'call-loop', output: 'ok' },
      ]);

      const warnSpy = jest.spyOn(
        (service as any).toolLoopRunner.logger,
        'warn',
      );

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'teste normal',
        messageSid: 'SM-NOLOOP',
        mediaUrl: null,
      });

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[AI_LOOP_LIMIT]'),
      );
      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        'Pronto.',
      );

      warnSpy.mockRestore();
    });
  });

  // ============================================================
  // Fase 4 — normalizeWhatsappText (sanitizador sem rewrite LLM)
  // ============================================================
  describe('normalizeWhatsappText (delegado a ResponseNormalizerService)', () => {
    const norm = (text: string) =>
      (service as any).responseNormalizer.normalizeWhatsappText(text);

    it('remove bloco de código (``` ... ```)', () => {
      const input = 'Aqui está:\n```json\n{"status": "ok"}\n```\nPronte.';
      const result = norm(input);
      expect(result).not.toContain('```');
      expect(result).not.toContain('{');
      expect(result).toContain('Aqui está');
      expect(result).toContain('Pronte');
    });

    it('strip JSON-like inline e loga warning', () => {
      const input = 'Resultado: {"status":"ok","id":"SC-001"} tudo certo.';
      const result = norm(input);
      expect(result).not.toContain('{');
      expect(result).toContain('tudo certo');
    });

    it('remove **negrito** mantendo o texto', () => {
      expect(norm('Texto **importante** aqui.')).toBe('Texto importante aqui.');
    });

    it('remove __sublinhado__ mantendo o texto', () => {
      expect(norm('Texto __sublinhado__ aqui.')).toBe('Texto sublinhado aqui.');
    });

    it('remove cabeçalhos Markdown (#, ##)', () => {
      expect(norm('## Título\nConteúdo')).toBe('Título\nConteúdo');
      expect(norm('# H1\nTexto')).toBe('H1\nTexto');
    });

    it('remove link Markdown [texto](url) mantendo só o texto', () => {
      expect(norm('Veja [aqui](https://inexci.com.br) os detalhes.')).toBe(
        'Veja aqui os detalhes.',
      );
    });

    it('remove linhas de tabela Markdown (|...|)', () => {
      const input = '| SC | Status |\n| --- | --- |\n| SC-001 | Pendente |';
      const result = norm(input);
      expect(result).not.toContain('|');
    });

    it('remove emojis (MAX_EMOJIS_PER_RESPONSE = 0)', () => {
      const result = norm('Pronto ✅ tudo certo 📅.');
      expect(result).not.toMatch(/[\p{Extended_Pictographic}]/u);
      expect(result).toContain('Pronto');
      expect(result).toContain('tudo certo');
    });

    it('colapsa múltiplas linhas em branco consecutivas em uma só', () => {
      const input = 'Linha 1\n\n\n\nLinha 2';
      const result = norm(input);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('trunca em 850 chars com sufixo quando exceder WHATSAPP_TARGET_LENGTH', () => {
      const longText = 'A'.repeat(900);
      const result = norm(longText);
      expect(result.length).toBeLessThanOrEqual(850);
      expect(result).toContain('Acesse a plataforma para mais detalhes');
    });

    it('converte listas com bullet em opções numeradas', () => {
      const input = '• criar SC\n• ver pacientes\n• encerrar';
      const result = norm(input);
      expect(result).toContain('1 - criar SC');
      expect(result).toContain('2 - ver pacientes');
      expect(result).toContain('3 - encerrar');
    });

    it('retorna fallback para texto vazio', () => {
      expect(norm('')).toContain('não consegui processar');
    });
  });

  // ============================================================
  // Fase 6 — RAG sob demanda (skip para inputs triviais)
  // ============================================================
  describe('Fase 6 — RAG sob demanda: skip para inputs triviais', () => {
    const defaultOpenaiResponse = {
      choices: [{ message: { content: 'ok', tool_calls: null } }],
    };

    beforeEach(() => {
      openaiServiceMock.chatCompletion.mockResolvedValue(defaultOpenaiResponse);
    });

    it('NÃO chama ragService.search quando input tem menos de 15 caracteres', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'oi',
        messageSid: 'SM-RAG-SHORT',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('NÃO chama ragService.search quando input é confirmação ("sim")', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'sim',
        messageSid: 'SM-RAG-SIM',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('NÃO chama ragService.search quando input é confirmação ("confirmo")', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'confirmo',
        messageSid: 'SM-RAG-CONFIRMO',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('NÃO chama ragService.search quando input é cancelamento ("não")', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'não',
        messageSid: 'SM-RAG-NAO',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('NÃO chama ragService.search quando input é cancelamento ("cancelar")', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'cancelar',
        messageSid: 'SM-RAG-CANCELAR',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('NÃO chama ragService.search quando input é número isolado "1"', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: '1',
        messageSid: 'SM-RAG-NUM1',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('NÃO chama ragService.search quando input é número isolado "2"', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: '2',
        messageSid: 'SM-RAG-NUM2',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).not.toHaveBeenCalled();
    });

    it('CHAMA ragService.search quando input é uma pergunta substantiva (≥15 chars)', async () => {
      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'quero criar uma solicitacao cirurgica para o paciente joao',
        messageSid: 'SM-RAG-QUERY',
        mediaUrl: null,
      });

      expect(ragServiceMock.search).toHaveBeenCalledWith(expect.any(String));
    });
  });
});
