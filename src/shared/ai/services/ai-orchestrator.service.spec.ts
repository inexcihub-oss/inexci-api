import OpenAI from 'openai';
import { AiOrchestratorService } from './ai-orchestrator.service';

describe('AiOrchestratorService (tool-calls integration)', () => {
  const queueMock = { add: jest.fn() };
  const openaiServiceMock = { chatCompletion: jest.fn() };
  const conversationServiceMock = {
    getOrCreateConversation: jest.fn(),
    appendMessage: jest.fn(),
    resetConversationHistory: jest.fn(),
    buildMessagesForOpenAI: jest.fn(),
  };
  const toolRegistryMock = { getToolDefinitions: jest.fn() };
  const toolExecutorMock = { executeMany: jest.fn() };
  const ragServiceMock = { search: jest.fn(), formatContext: jest.fn() };
  const whatsappServiceMock = { sendMessage: jest.fn() };
  const userRepositoryMock = { findOneByPhone: jest.fn() };
  const accessControlMock = { getAccessibleDoctorIds: jest.fn() };
  const pendencyValidatorMock = { validateForStatus: jest.fn() };
  const surgeryRequestRepoMock = { findOneSimple: jest.fn() };
  const aiTokenUsageLogRepoMock = { create: jest.fn() };
  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'AI_PROCESS_TIMEOUT_MS') return 90000;
      return defaultValue;
    }),
  };

  let service: AiOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();

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
    );

    userRepositoryMock.findOneByPhone.mockResolvedValue({ id: 'user-1' });
    accessControlMock.getAccessibleDoctorIds.mockResolvedValue(['doctor-1']);

    const conversation = {
      id: 'conv-1',
      phone: '+5511999999999',
      user_id: 'user-1',
      messages_history: [],
    };

    conversationServiceMock.getOrCreateConversation.mockResolvedValue(
      conversation,
    );
    conversationServiceMock.appendMessage.mockResolvedValue(undefined);
    conversationServiceMock.resetConversationHistory.mockResolvedValue(
      undefined,
    );
    conversationServiceMock.buildMessagesForOpenAI.mockReturnValue([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'mensagem' },
    ]);

    ragServiceMock.search.mockResolvedValue([]);
    ragServiceMock.formatContext.mockResolvedValue('');
    toolRegistryMock.getToolDefinitions.mockReturnValue([]);
    pendencyValidatorMock.validateForStatus.mockResolvedValue({
      pendencies: [],
    });
    surgeryRequestRepoMock.findOneSimple.mockResolvedValue({
      id: 'req-1',
      doctor_id: 'doctor-1',
    });
    aiTokenUsageLogRepoMock.create.mockResolvedValue(undefined);
  });

  it('deve manter loop de tool_calls e responder com follow-up', async () => {
    const toolCall: OpenAI.ChatCompletionMessageToolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'confirm_date',
        arguments: JSON.stringify({ surgery_request_id: 'req-1' }),
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
          return { id: 'user-1' };
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
          return { id: 'user-1' };
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
          surgery_request_id: 'req-1',
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
});
