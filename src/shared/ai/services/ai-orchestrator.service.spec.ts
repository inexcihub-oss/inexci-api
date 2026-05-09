import OpenAI from 'openai';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';
import { WHATSAPP_TEMPLATES } from '../../whatsapp/whatsapp-templates.constants';

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
  const toolRegistryMock = { getToolDefinitions: jest.fn() };
  const toolExecutorMock = { executeMany: jest.fn() };
  const ragServiceMock = { search: jest.fn(), formatContext: jest.fn() };
  const whatsappServiceMock = {
    sendMessage: jest.fn(),
    sendTemplate: jest.fn(),
  };
  const userRepositoryMock = { findOneByPhone: jest.fn() };
  const accessControlMock = { getAccessibleDoctorIds: jest.fn() };
  const pendencyValidatorMock = { validateForStatus: jest.fn() };
  const surgeryRequestRepoMock = { findOneSimple: jest.fn() };
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
      queueMock as any,
      openaiServiceMock as any,
      conversationServiceMock as any,
      toolRegistryMock as any,
      toolExecutorMock as any,
      ragServiceMock as any,
      whatsappServiceMock as any,
      userRepositoryMock as any,
      accessControlMock as any,
      pendencyValidatorMock as any,
      surgeryRequestRepoMock as any,
      aiTokenUsageLogRepoMock as any,
      configServiceMock as any,
      transcriptionServiceMock as any,
      whatsappMediaServiceMock as any,
      piiVault,
      piiRedactionLogRepoMock as any,
      aiRedisMock as any,
      defaultContextServiceMock as any,
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
        name: 'confirm_date',
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
    expect(ragServiceMock.search).toHaveBeenCalledWith(
      'texto transcrito',
      3,
      0.65,
    );
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
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      '⚠️ Não consegui transcrever seu áudio desta vez. Pode tentar novamente enviando outro áudio mais curto ou, se preferir, digitar a mensagem?',
    );
  });

  it('deve reescrever e normalizar resposta mal formatada para WhatsApp', async () => {
    openaiServiceMock.chatCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '# Status\n- item técnico\n```json\n{"ok":true}\n```',
              tool_calls: null,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                'Atualizei sua solicitação.\n- Próximo passo: revisar pendências.',
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

    expect(openaiServiceMock.chatCompletion).toHaveBeenCalledTimes(2);
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+5511888888888',
      'Atualizei sua solicitação.\n1 - Próximo passo: revisar pendências.',
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

  it('deve enriquecer resultado de mutação com próximo passo recomendado', async () => {
    const toolCall: OpenAI.ChatCompletionMessageToolCall = {
      id: 'call-next',
      type: 'function',
      function: {
        name: 'update_request_admin_data',
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
        output:
          'Dados administrativos atualizados com sucesso na solicitação SC-0042.',
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
      body: 'atualizar dados administrativos',
      messageSid: 'SM7',
      mediaUrl: null,
    });

    const secondCallArgs = openaiServiceMock.chatCompletion.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m: any) => m.role === 'tool',
    );

    expect(toolMessage.content).toContain('Próximo passo recomendado');
    expect(toolMessage.content).toContain('update_patient_data');
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

    it('bloqueia chamada à OpenAI quando o histórico contém PII residual e registra no log', async () => {
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

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'consulta normal',
        messageSid: 'SM-PII-BLOCK',
        mediaUrl: null,
      });

      expect(openaiServiceMock.chatCompletion).not.toHaveBeenCalled();
      expect(piiRedactionLogRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          messageSid: 'SM-PII-BLOCK',
          category: 'cpf',
          blocked: true,
        }),
      );
      expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('dado sensível'),
      );
    });

    it('persiste bindings do vault entre turnos para evitar placeholders órfãos no WhatsApp', async () => {
      // Reproduz o bug: turno 1 tokeniza protocols/patient_names, salva no
      // histórico; turno 2 reaproveita placeholders mas a sessão do vault é
      // nova. Sem persistência de bindings, o detokenize devolveria texto
      // com `{{protocol_1}}` cru (exatamente o que o usuário viu).
      const piiVaultStore = new PiiVaultService();
      service = new AiOrchestratorService(
        queueMock as any,
        openaiServiceMock as any,
        conversationServiceMock as any,
        toolRegistryMock as any,
        toolExecutorMock as any,
        ragServiceMock as any,
        whatsappServiceMock as any,
        userRepositoryMock as any,
        accessControlMock as any,
        pendencyValidatorMock as any,
        surgeryRequestRepoMock as any,
        aiTokenUsageLogRepoMock as any,
        configServiceMock as any,
        transcriptionServiceMock as any,
        whatsappMediaServiceMock as any,
        piiVaultStore,
        piiRedactionLogRepoMock as any,
        aiRedisMock as any,
        defaultContextServiceMock as any,
      );

      const tool: OpenAI.ChatCompletionMessageToolCall = {
        id: 'call-list',
        type: 'function',
        function: {
          name: 'list_surgery_requests',
          arguments: JSON.stringify({}),
        },
      };

      // Turno 1: tool tokeniza diretamente no vault (como em produção) e o
      // LLM responde reaproveitando os placeholders.
      toolExecutorMock.executeMany.mockImplementationOnce(
        async (_calls: any[], context: any) => {
          context.piiVault.tokenize(
            context.conversationId,
            'SC-0042',
            'protocol',
          );
          context.piiVault.tokenize(
            context.conversationId,
            'João Silva',
            'patient_name',
          );
          return [
            {
              toolCallId: 'call-list',
              output: '• {{protocol_1}} — {{patient_name_1}} — Finalizada',
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
                  'Encontrei: 1 - {{protocol_1}} — {{patient_name_1}} — Finalizada',
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
                'A SC mais recente é {{protocol_1}} do paciente {{patient_name_1}}.',
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
        queueMock as any,
        openaiServiceMock as any,
        conversationServiceMock as any,
        toolRegistryMock as any,
        toolExecutorMock as any,
        ragServiceMock as any,
        whatsappServiceMock as any,
        userRepositoryMock as any,
        accessControlMock as any,
        pendencyValidatorMock as any,
        surgeryRequestRepoMock as any,
        aiTokenUsageLogRepoMock as any,
        configServiceMock as any,
        transcriptionServiceMock as any,
        whatsappMediaServiceMock as any,
        piiVaultStore,
        piiRedactionLogRepoMock as any,
        redisAvailableMock as any,
        defaultContextServiceMock as any,
      );

      const tool: OpenAI.ChatCompletionMessageToolCall = {
        id: 'call-list',
        type: 'function',
        function: {
          name: 'list_surgery_requests',
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

      expect(redisAvailableMock.cacheSet).toHaveBeenCalledWith(
        expect.stringContaining('pii:vault:conv-1'),
        expect.arrayContaining([
          expect.objectContaining({
            token: '{{protocol_1}}',
            category: 'protocol',
            realValue: 'SC-9999',
          }),
        ]),
        expect.any(Number),
      );
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

  describe('Plano Tokens (Fase 4) — slot-filling', () => {
    it('slot-filling bloqueia create_surgery_request_from_whatsapp quando faltar slot e pergunta o slot', async () => {
      conversationServiceMock.getOrCreateConversation.mockResolvedValue({
        id: 'conv-1',
        phone: '+5511999999999',
        userId: 'user-1',
        messagesHistory: [],
        conversationMemory: { filled_slots: { 'patient.id': 'p-1' } },
      });

      openaiServiceMock.chatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-create',
                  type: 'function',
                  function: {
                    name: 'create_surgery_request_from_whatsapp',
                    arguments: JSON.stringify({
                      patient: { id: 'p-1' },
                    }),
                  },
                },
              ],
            },
          },
        ],
      });

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'criar SC',
        messageSid: 'SM-SLOT-1',
        mediaUrl: null,
      });

      expect(toolExecutorMock.executeMany).not.toHaveBeenCalled();
      const sentBody = (
        whatsappServiceMock.sendMessage as jest.Mock
      ).mock.calls.at(-1)?.[1] as string;
      expect(sentBody).toMatch(/hospital/i);
    });

    it('slot-filling não bloqueia tool não-mutativa de criação', async () => {
      openaiServiceMock.chatCompletion
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'confirm_date',
                      arguments: JSON.stringify({
                        surgeryRequestId: 'req-1',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Ok', tool_calls: null } }],
        });
      toolExecutorMock.executeMany.mockResolvedValue([
        { toolCallId: 'call-1', output: 'ok' },
      ]);

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'confirmar',
        messageSid: 'SM-SLOT-2',
        mediaUrl: null,
      });

      expect(toolExecutorMock.executeMany).toHaveBeenCalled();
    });

    it('slot-filling NÃO bloqueia quando todos os campos foram fornecidos', async () => {
      openaiServiceMock.chatCompletion
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-create',
                    type: 'function',
                    function: {
                      name: 'create_surgery_request_from_whatsapp',
                      arguments: JSON.stringify({
                        patient: { id: 'p-1' },
                        surgeryRequest: {
                          hospital: 'Hosp X',
                          healthPlan: 'Plano Y',
                        },
                        tussItems: [{ code: '111' }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            { message: { content: 'SC criada com sucesso', tool_calls: null } },
          ],
        });
      toolExecutorMock.executeMany.mockResolvedValue([
        { toolCallId: 'call-create', output: 'criada' },
      ]);

      await service.processMessage({
        from: 'whatsapp:+5511999999999',
        body: 'criar SC com tudo',
        messageSid: 'SM-SLOT-3',
        mediaUrl: null,
      });

      expect(toolExecutorMock.executeMany).toHaveBeenCalled();
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
});
