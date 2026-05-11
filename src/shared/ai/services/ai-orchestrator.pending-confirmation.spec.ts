import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';

/**
 * Testes focados na nova camada de "pending_confirmation": o orchestrator
 * grava no conversation_memory quando uma tool de mutação retorna preview
 * (confirm:false) e, no turno seguinte, traduz determinísticamente um
 * "sim/confirmo/ok" do usuário em chamada da MESMA tool com confirm:true,
 * sem depender do LLM lembrar do contexto.
 *
 * Acessamos as funções privadas via `as any` para testá-las isoladamente —
 * a integração via fluxo de turno é coberta pelos testes principais do
 * orchestrator.
 */
describe('AiOrchestratorService — pending_confirmation', () => {
  let service: AiOrchestratorService;
  const whatsappConversationRepoMock = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiOrchestratorService(
      { add: jest.fn() } as any,
      { chatCompletion: jest.fn() } as any,
      {
        getOrCreateConversation: jest.fn(),
        appendMessage: jest.fn(),
        resetConversationHistory: jest.fn(),
        loadRecentForLlm: jest.fn(),
      } as any,
      { getToolDefinitions: jest.fn() } as any,
      { executeMany: jest.fn() } as any,
      { search: jest.fn(), formatContext: jest.fn() } as any,
      { sendMessage: jest.fn(), sendTemplate: jest.fn() } as any,
      { findOneByPhone: jest.fn() } as any,
      { getAccessibleDoctorIds: jest.fn() } as any,
      { validateForStatus: jest.fn() } as any,
      { findOneSimple: jest.fn() } as any,
      { create: jest.fn() } as any,
      { get: jest.fn() } as any,
      { transcribe: jest.fn() } as any,
      { isAudioMime: jest.fn(), downloadInboundAudio: jest.fn() } as any,
      new PiiVaultService() as any,
      { create: jest.fn() } as any,
      {
        isAvailable: false,
        checkRateLimit: jest.fn(),
        cacheGet: jest.fn(),
        cacheSet: jest.fn(),
        cacheDelete: jest.fn(),
        setFlag: jest.fn(),
        hasFlag: jest.fn(),
      } as any,
      { buildContext: jest.fn() } as any,
      whatsappConversationRepoMock as any,
      {
        getCurrent: jest.fn().mockResolvedValue(null),
        getCurrentOfType: jest.fn().mockResolvedValue(null),
        start: jest.fn(),
        setField: jest.fn(),
        setFields: jest.fn(),
        setStatus: jest.fn(),
        validate: jest.fn().mockResolvedValue({ isReady: false, missing: [] }),
        getPreview: jest.fn().mockResolvedValue({ text: '', draft: null }),
        cancel: jest.fn(),
        finalizeCommit: jest.fn(),
      } as any,
      {
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
      } as any,
      {
        processPendingDocument: jest
          .fn()
          .mockResolvedValue({ status: 'ok', userSummary: 'resumo' }),
      } as any,
    );
  });

  describe('parseAffirmativeConfirmation', () => {
    const cases = [
      'sim',
      'Sim',
      'SIM',
      's',
      'ok',
      'okay',
      'confirmo',
      'confirma',
      'pode',
      'manda',
      'manda ver',
      'vamos',
      'isso',
      'isso mesmo',
      'beleza',
      'show',
      'positivo',
      'quero sim',
    ];
    it.each(cases)('"%s" → afirmativo', (input) => {
      const result = (service as any).parseAffirmativeConfirmation(input);
      expect(result).toBe(true);
    });

    it('respostas longas não são tratadas como confirmação', () => {
      const longInput =
        'Sim, mas antes preciso te perguntar uma coisa sobre o procedimento e o convênio';
      expect((service as any).parseAffirmativeConfirmation(longInput)).toBe(
        false,
      );
    });

    it('frases ambíguas não são confirmação', () => {
      expect(
        (service as any).parseAffirmativeConfirmation(
          'gostaria de criar uma SC',
        ),
      ).toBe(false);
    });
  });

  describe('parseNegativeConfirmation', () => {
    it.each(['não', 'nao', 'cancela', 'esquece', 'desiste', 'pare'])(
      '"%s" → negativo',
      (input) => {
        const result = (service as any).parseNegativeConfirmation(input);
        expect(result).toBe(true);
      },
    );
  });

  describe('looksLikeConfirmationPreview', () => {
    it('detecta preview de cadastro de procedimento', () => {
      const out = [
        'Confirme o cadastro do procedimento:',
        'Nome: cirurgia no joelho',
        '',
        'Responda "sim" para confirmar e cadastrar.',
      ].join('\n');
      expect((service as any).looksLikeConfirmationPreview(out)).toBe(true);
    });

    it('NÃO detecta mensagem de sucesso', () => {
      expect(
        (service as any).looksLikeConfirmationPreview(
          'Procedimento "Cirurgia no Joelho" cadastrado com sucesso.',
        ),
      ).toBe(false);
    });
  });

  describe('looksLikeExecutedMutation', () => {
    it.each([
      'Procedimento "X" cadastrado com sucesso.',
      'Paciente cadastrada com sucesso.',
      'SC criada com sucesso.',
    ])('"%s" → executado', (input) => {
      expect((service as any).looksLikeExecutedMutation(input)).toBe(true);
    });

    it('preview pendente → não executado', () => {
      expect(
        (service as any).looksLikeExecutedMutation(
          'Responda "sim" para confirmar e cadastrar.',
        ),
      ).toBe(false);
    });
  });

  describe('trackPendingConfirmation', () => {
    it('grava pending_confirmation quando preview é retornado', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await (service as any).trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'create_procedure',
        args: { name: 'cirurgia no joelho', confirm: false },
        output:
          'Confirme o cadastro do procedimento:\nNome: cirurgia no joelho\n\nResponda "sim" para confirmar e cadastrar.',
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalledTimes(1);
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toMatchObject({
        tool: 'create_procedure',
        args: { name: 'cirurgia no joelho', confirm: true },
      });
      expect(
        patch.conversationMemory.pending_confirmation.createdAt,
      ).toBeTruthy();
    });

    it('limpa pending_confirmation quando mutação executou com sucesso', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'create_procedure',
            args: { name: 'x' },
            description: 'cadastrar o procedimento',
            createdAt: new Date().toISOString(),
          },
        },
      });

      await (service as any).trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'create_procedure',
        args: { name: 'cirurgia no joelho', confirm: true },
        output: 'Procedimento "cirurgia no joelho" cadastrado com sucesso.',
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toBeNull();
    });

    it('não mexe no estado para tools que não estão na allowlist', async () => {
      await (service as any).trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'list_patients',
        args: {},
        output: 'qualquer coisa',
      });

      expect(whatsappConversationRepoMock.findOne).not.toHaveBeenCalled();
      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });
  });

  describe('buildPendingConfirmationHint', () => {
    it('injeta hint determinístico quando há pending_confirmation fresco e usuário diz "sim"', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'create_procedure',
            args: { name: 'cirurgia no joelho', confirm: true },
            description: 'cadastrar o procedimento',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const hint = await (service as any).buildPendingConfirmationHint(
        'conv-1',
        'Sim',
      );

      expect(hint).toContain('CONFIRMAÇÃO DETERMINÍSTICA');
      expect(hint).toContain('create_procedure');
      expect(hint).toContain('cirurgia no joelho');
      expect(hint).toContain('"confirm":true');
    });

    it('retorna null quando não há pending_confirmation', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const hint = await (service as any).buildPendingConfirmationHint(
        'conv-1',
        'Sim',
      );
      expect(hint).toBeNull();
    });

    it('retorna null e limpa pending_confirmation quando está expirado (>15min)', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'create_procedure',
            args: { name: 'velho' },
            description: 'cadastrar o procedimento',
            createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          },
        },
      });

      const hint = await (service as any).buildPendingConfirmationHint(
        'conv-1',
        'Sim',
      );
      expect(hint).toBeNull();
      // O orchestrator deve ter agendado a limpeza.
      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
    });

    it('cancela quando usuário responde "não" e há pending_confirmation', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'create_procedure',
            args: { name: 'cirurgia no joelho' },
            description: 'cadastrar o procedimento',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const hint = await (service as any).buildPendingConfirmationHint(
        'conv-1',
        'Não',
      );

      expect(hint).toContain('CANCELAMENTO DETERMINÍSTICO');
      expect(hint).toContain('cadastrar o procedimento');
      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
    });

    it('não dispara hint para input sem relação com confirmação', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'create_procedure',
            args: { name: 'cirurgia no joelho' },
            description: 'cadastrar o procedimento',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const hint = await (service as any).buildPendingConfirmationHint(
        'conv-1',
        'na verdade, quero mudar o procedimento',
      );

      expect(hint).toBeNull();
    });
  });

  describe('memorizeEntitiesFromToolCall', () => {
    it('grava paciente em filled_slots após create_patient confirmado', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'create_patient',
        args: { name: 'Beatriz Helena', confirm: true },
        output: 'Paciente Beatriz Helena cadastrada com sucesso.',
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.filled_slots.patient).toBe(
        'Beatriz Helena',
      );
    });

    it('grava procedimento E hospital E convênio quando create_surgery_request_from_whatsapp é executado', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'create_surgery_request_from_whatsapp',
        args: {
          patient_name: 'Beatriz Helena',
          procedure_name: 'Artroscopia de Joelho',
          hospital_name: 'Albert Einstein',
          health_plan_name: 'Unimed',
          priority: 2,
        },
        output: 'SC criada com sucesso.',
      });

      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.filled_slots.patient).toBe(
        'Beatriz Helena',
      );
      expect(patch.conversationMemory.filled_slots.procedure).toBe(
        'Artroscopia de Joelho',
      );
      expect(patch.conversationMemory.filled_slots.priority).toBe('2');
      expect(patch.conversationMemory.surgeryRequest.hospital).toBe(
        'Albert Einstein',
      );
      expect(patch.conversationMemory.surgeryRequest.healthPlan).toBe('Unimed');
    });

    it('NÃO grava se a tool foi preview (confirm:false)', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'create_procedure',
        args: { name: 'X', confirm: false },
        output: 'Confirme o cadastro do procedimento: Nome: X',
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });

    it('ignora tools fora do mapeamento (ex.: list_patients)', async () => {
      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'list_patients',
        args: { search: 'Beatriz' },
        output: 'Beatriz | id: x | telefone: ...',
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });
  });

  describe('mensagens de falha do STT', () => {
    it.each([
      ['STT_PROVIDER_UNREACHABLE', 'serviço de transcrição'],
      ['STT_PROVIDER_ERROR', 'erro'],
      ['STT_EMPTY_TRANSCRIPTION', 'não consegui identificar'],
      ['AUDIO_TOO_LONG', '5 minutos'],
      ['AUDIO_TOO_LARGE', 'muito grande'],
      ['AUDIO_NOT_ALLOWED', 'formato'],
    ])('reason=%s contém pista útil', (reason, hint) => {
      const msg = (service as any).buildAudioFailureUserMessage(reason);
      expect(msg.toLowerCase()).toContain(hint.toLowerCase());
    });
  });
});
