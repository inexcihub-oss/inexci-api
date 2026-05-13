import { AiOrchestratorService } from './ai-orchestrator.service';
import { PiiVaultService } from './pii-vault.service';
import { ResponseNormalizerService } from './orchestrator/response-normalizer.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { ClearContextDetectorService } from './orchestrator/clear-context-detector.service';
import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import { OrchestratorTelemetryService } from './orchestrator/orchestrator-telemetry.service';
import { MessageProcessorService } from './orchestrator/message-processor.service';
import { AudioIntakeService } from './orchestrator/audio-intake.service';

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
      { chatCompletion: jest.fn() } as any,
      {
        getOrCreateConversation: jest.fn(),
        appendMessage: jest.fn(),
        resetConversationHistory: jest.fn(),
        loadRecentForLlm: jest.fn(),
      } as any,
      {
        getToolDefinitions: jest.fn().mockReturnValue([]),
        getToolDefinitionsForDraft: jest.fn().mockReturnValue([]),
      } as any,
      { executeMany: jest.fn() } as any,
      { search: jest.fn(), formatContext: jest.fn() } as any,
      { sendMessage: jest.fn(), sendTemplate: jest.fn() } as any,
      { findOneByPhone: jest.fn() } as any,
      { getAccessibleDoctorIds: jest.fn() } as any,
      { validateForStatus: jest.fn() } as any,
      { findOneSimple: jest.fn() } as any,
      { get: jest.fn() } as any,
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
      new ResponseNormalizerService(),
      new PhoneNormalizerService({ findOneByPhone: jest.fn() } as any),
      new ClearContextDetectorService(),
      new ConfirmationManagerService(
        whatsappConversationRepoMock as any,
        { loadRecentForLlm: jest.fn() } as any,
      ),
      new OrchestratorTelemetryService(
        { create: jest.fn() } as any,
        new PhoneNormalizerService({ findOneByPhone: jest.fn() } as any),
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
      const result = (
        service as any
      ).confirmationManager.parseAffirmativeConfirmation(input);
      expect(result).toBe(true);
    });

    it('respostas longas não são tratadas como confirmação', () => {
      const longInput =
        'Sim, mas antes preciso te perguntar uma coisa sobre o procedimento e o convênio';
      expect(
        (service as any).confirmationManager.parseAffirmativeConfirmation(
          longInput,
        ),
      ).toBe(false);
    });

    it('frases ambíguas não são confirmação', () => {
      expect(
        (service as any).confirmationManager.parseAffirmativeConfirmation(
          'gostaria de criar uma SC',
        ),
      ).toBe(false);
    });
  });

  describe('parseNegativeConfirmation', () => {
    it.each(['não', 'nao', 'cancela', 'esquece', 'desiste', 'pare'])(
      '"%s" → negativo',
      (input) => {
        const result = (
          service as any
        ).confirmationManager.parseNegativeConfirmation(input);
        expect(result).toBe(true);
      },
    );
  });

  describe('trackPendingConfirmation', () => {
    // Fase 4 do PLANO-SANITIZACAO-CLEAN-CODE-IA: o caminho legacy (texto
    // livre + PREVIEWABLE_MUTATION_TOOLS + heurísticas de string) foi
    // removido. Toda tool que queira participar do ciclo de confirmação
    // devolve `ToolResult` canônico (envelope JSON via `buildToolResult`).
    it('grava pending_confirmation a partir do envelope de upload_doctor_signature', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const envelope = JSON.stringify({
        status: 'pending_confirmation',
        message: 'Aguardando confirmação',
        display_text:
          'Sua assinatura digital será atualizada. Confirme com "sim".',
        pending_confirmation: {
          tool: 'upload_doctor_signature',
          args: { confirm: true },
          description: 'atualizar sua assinatura digital',
        },
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: { confirm: false },
        output: envelope,
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalledTimes(1);
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toMatchObject({
        tool: 'upload_doctor_signature',
        args: { confirm: true },
      });
      expect(
        patch.conversationMemory.pending_confirmation.createdAt,
      ).toBeTruthy();
    });

    it('limpa pending_confirmation quando upload_doctor_signature retorna envelope ok', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'upload_doctor_signature',
            args: {},
            description: 'atualizar sua assinatura digital',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const envelope = JSON.stringify({
        status: 'ok',
        message: 'Assinatura digital atualizada com sucesso.',
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: { confirm: true },
        output: envelope,
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toBeNull();
    });

    it('quando output não é envelope, loga warning e NÃO mexe no pending', async () => {
      const warnSpy = jest
        .spyOn(
          (service as any).confirmationManager.logger as { warn: () => void },
          'warn',
        )
        .mockImplementation(() => undefined);

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'query_patients',
        args: {},
        output: 'qualquer coisa em texto livre',
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('envelope_missing'),
      );

      warnSpy.mockRestore();
    });

    // Regressão: o loop "responda 'sim' para confirmar" no fluxo de
    // criação de SC vinha do fato de `sc_draft_preview` não estar na
    // allowlist hardcoded — então nada era gravado e o "sim" do usuário
    // não disparava o commit.
    it('grava pending a partir do envelope JSON de sc_draft_preview (apontando sc_draft_commit)', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const envelope = JSON.stringify({
        status: 'pending_confirmation',
        message: 'Aguardando confirmação do usuário para criar a SC.',
        display_text:
          '*Criação de solicitação cirúrgica — preview:*\n...\nResponda "sim" para confirmar ou "não" para cancelar.',
        pending_confirmation: {
          tool: 'sc_draft_commit',
          args: { confirm: true },
          description: 'Cria a SC com os dados do rascunho atual.',
        },
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'sc_draft_preview',
        args: {},
        output: envelope,
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalledTimes(1);
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toMatchObject({
        tool: 'sc_draft_commit',
        args: { confirm: true },
      });
    });

    it('grava pending a partir de qualquer *_draft_preview por convenção de nome', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const envelope = JSON.stringify({
        status: 'pending_confirmation',
        display_text:
          '*Faturamento — preview:*\n...\nResponda "sim" para confirmar ou "não" para cancelar.',
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'invoice_draft_preview',
        args: {},
        output: envelope,
      });

      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toMatchObject({
        tool: 'invoice_draft_commit',
        args: { confirm: true },
      });
    });

    it('grava pending quando *_draft_commit é chamada sem confirm:true', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const envelope = JSON.stringify({
        status: 'pending_confirmation',
        message:
          'Para criar a SC, chame esta tool com `confirm=true` após receber confirmação do usuário.',
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'sc_draft_commit',
        args: { confirm: false },
        output: envelope,
      });

      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toMatchObject({
        tool: 'sc_draft_commit',
        args: { confirm: true },
      });
    });

    it('limpa pending quando *_draft_commit retorna status:ok', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'sc_draft_commit',
            args: { confirm: true },
            description: 'criar a solicitação cirúrgica',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const envelope = JSON.stringify({
        status: 'ok',
        data: { id: 'req-1', protocol: 'SC-1234' },
        message: 'Solicitação SC-1234 criada com sucesso.',
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'sc_draft_commit',
        args: { confirm: true },
        output: envelope,
      });

      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toBeNull();
    });

    it('NÃO limpa pending quando uma tool de leitura retorna status:ok', async () => {
      const envelope = JSON.stringify({
        status: 'ok',
        data: { results: [] },
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'query_patients',
        args: {},
        output: envelope,
      });

      // Nenhum update — o pending de outra mutação fica preservado.
      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });

    it('ignora envelope com status needs_input / blocked / error', async () => {
      const envelope = JSON.stringify({
        status: 'needs_input',
        next_required_fields: ['patient_name_or_id'],
        message: 'Informe o nome ou ID do paciente.',
        v: 1,
      });

      await (service as any).confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'sc_draft_set_patient',
        args: {},
        output: envelope,
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });
  });

  describe('buildPendingConfirmationHint', () => {
    // Migrado em 2026-05-12 (Fase 3.3): os testes do hint usavam
    // `create_procedure` como cobaia. Como ela foi removida do registry, o
    // novo cobaia é `upload_doctor_signature` (única tool legacy que ainda
    // exercita o caminho heurístico). O comportamento testado é genérico —
    // o hint só monta uma string a partir de `pending_confirmation`.
    it('injeta hint determinístico quando há pending_confirmation fresco e usuário diz "sim"', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'upload_doctor_signature',
            args: { mediaIndex: 0, confirm: true },
            description: 'atualizar sua assinatura digital',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const hint = await (
        service as any
      ).confirmationManager.buildPendingConfirmationHint('conv-1', 'Sim');

      expect(hint).toContain('CONFIRMAÇÃO DETERMINÍSTICA');
      expect(hint).toContain('upload_doctor_signature');
      expect(hint).toContain('"confirm":true');
    });

    it('retorna null quando não há pending_confirmation', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const hint = await (
        service as any
      ).confirmationManager.buildPendingConfirmationHint('conv-1', 'Sim');
      expect(hint).toBeNull();
    });

    it('retorna null e limpa pending_confirmation quando está expirado (>15min)', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'upload_doctor_signature',
            args: {},
            description: 'atualizar sua assinatura digital',
            createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          },
        },
      });

      const hint = await (
        service as any
      ).confirmationManager.buildPendingConfirmationHint('conv-1', 'Sim');
      expect(hint).toBeNull();
      // O orchestrator deve ter agendado a limpeza.
      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
    });

    it('cancela quando usuário responde "não" e há pending_confirmation', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'upload_doctor_signature',
            args: {},
            description: 'atualizar sua assinatura digital',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const hint = await (
        service as any
      ).confirmationManager.buildPendingConfirmationHint('conv-1', 'Não');

      expect(hint).toContain('CANCELAMENTO DETERMINÍSTICO');
      expect(hint).toContain('atualizar sua assinatura digital');
      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
    });

    it('não dispara hint para input sem relação com confirmação', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'upload_doctor_signature',
            args: {},
            description: 'atualizar sua assinatura digital',
            createdAt: new Date().toISOString(),
          },
        },
      });

      const hint = await (
        service as any
      ).confirmationManager.buildPendingConfirmationHint(
        'conv-1',
        'na verdade, quero mudar a foto',
      );

      expect(hint).toBeNull();
    });
  });

  describe('memorizeEntitiesFromToolCall', () => {
    // Migrado em 2026-05-12 (Fase 3.3): os testes desta suíte usavam
    // `create_procedure` (case do switch) para validar o memorize. Como a
    // tool foi removida do registry e o case correspondente saiu junto, o
    // novo cobaia é `set_hospital` — ela continua válida, no switch e grava
    // entidade em `conversationMemory.surgeryRequest`.
    //
    // Removidos antes:
    //  - `create_surgery_request_from_whatsapp` (Fase 3.1): substituída por
    //    `sc_draft_*`, que mantém `fields` em `operationDraft`.
    //  - `create_patient` (Fase 3.2): substituída por `patient_draft_*`.
    it('grava hospital em surgeryRequest após set_hospital', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'set_hospital',
        args: {
          protocol: 'SC-0001',
          hospital_name: 'Hospital Albert Einstein',
        },
        output: 'Hospital "Hospital Albert Einstein" vinculado à SC SC-0001.',
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.surgeryRequest.hospital).toBe(
        'Hospital Albert Einstein',
      );
    });

    it('NÃO grava quando o envelope canônico devolve status diferente de ok (preview/blocked/error)', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      // Fase 4: o gate é via envelope canônico (status !== 'ok' não memoriza).
      // Mesmo que o switch reconhecesse `set_hospital`, o envelope de preview
      // bloqueia a memorização — só após o commit (status:ok).
      const previewEnvelope = JSON.stringify({
        status: 'pending_confirmation',
        message: 'Aguardando confirmação',
        v: 1,
      });

      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'set_hospital',
        args: { hospital_name: 'Hospital Albert Einstein' },
        output: previewEnvelope,
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });

    it('ignora tools fora do mapeamento (ex.: list_patients)', async () => {
      await (service as any).memorizeEntitiesFromToolCall({
        conversationId: 'conv-1',
        toolName: 'query_patients',
        args: { search: 'Beatriz' },
        output: 'Beatriz | id: x | telefone: ...',
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
    });
  });

  describe('mensagens de falha do STT', () => {
    const audioIntakeService = new AudioIntakeService(
      null as any,
      null as any,
      { get: jest.fn().mockReturnValue('true') } as any,
    );
    it.each([
      ['STT_PROVIDER_UNREACHABLE', 'serviço de transcrição'],
      ['STT_PROVIDER_ERROR', 'erro'],
      ['STT_EMPTY_TRANSCRIPTION', 'não consegui identificar'],
      ['AUDIO_TOO_LONG', '5 minutos'],
      ['AUDIO_TOO_LARGE', 'muito grande'],
      ['AUDIO_NOT_ALLOWED', 'formato'],
    ])('reason=%s contém pista útil', (reason, hint) => {
      const msg = audioIntakeService.buildAudioFailureUserMessage(reason);
      expect(msg.toLowerCase()).toContain(hint.toLowerCase());
    });
  });
});
