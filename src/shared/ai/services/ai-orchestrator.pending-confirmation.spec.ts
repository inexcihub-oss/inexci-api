import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import { AudioIntakeService } from './orchestrator/audio-intake.service';

/**
 * Testes focados na nova camada de "pending_confirmation": o ConfirmationManagerService
 * grava no conversation_memory quando uma tool de mutação retorna preview
 * (confirm:false) e, no turno seguinte, traduz determinísticamente um
 * "sim/confirmo/ok" do usuário em chamada da MESMA tool com confirm:true,
 * sem depender do LLM lembrar do contexto.
 */
describe('ConfirmationManagerService — pending_confirmation', () => {
  let confirmationManager: ConfirmationManagerService;
  const whatsappConversationRepoMock = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    confirmationManager = new ConfirmationManagerService(
      whatsappConversationRepoMock as any,
      { loadRecentForLlm: jest.fn() } as any,
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
      const result = confirmationManager.parseAffirmativeConfirmation(input);
      expect(result).toBe(true);
    });

    it('respostas longas não são tratadas como confirmação', () => {
      const longInput =
        'Sim, mas antes preciso te perguntar uma coisa sobre o procedimento e o convênio';
      expect(
        confirmationManager.parseAffirmativeConfirmation(longInput),
      ).toBe(false);
    });

    it('frases ambíguas não são confirmação', () => {
      expect(
        confirmationManager.parseAffirmativeConfirmation('gostaria de criar uma SC'),
      ).toBe(false);
    });
  });

  describe('parseNegativeConfirmation', () => {
    it.each(['não', 'nao', 'cancela', 'esquece', 'desiste', 'pare'])(
      '"%s" → negativo',
      (input) => {
        const result = confirmationManager.parseNegativeConfirmation(input);
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

      await confirmationManager.trackPendingConfirmation({
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

      await confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: { confirm: true },
        output: envelope,
      });

      expect(whatsappConversationRepoMock.update).toHaveBeenCalled();
      const [, patch] = whatsappConversationRepoMock.update.mock.calls[0];
      expect(patch.conversationMemory.pending_confirmation).toBeNull();
    });

    it('quando tool confirmável devolve output não-envelope, loga warning e NÃO mexe no pending', async () => {
      const warnSpy = jest
        .spyOn(
          (confirmationManager as any).logger as { warn: () => void },
          'warn',
        )
        .mockImplementation(() => undefined);

      // `upload_doctor_signature` é confirmable (está em TOOL_DISPLAY_LABELS)
      // mas, hipoteticamente, devolve string crua — caminho de regressão
      // que justifica o warning.
      await confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: {},
        output: 'qualquer coisa em texto livre',
      });

      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('envelope_missing'),
      );

      warnSpy.mockRestore();
    });

    // Tools de leitura (`query_patients`, `query_surgery_requests`,
    // `get_pendencies`, `search_*`) devolvem string crua de propósito —
    // não devem disparar o warning `envelope_missing`.
    it('tool de leitura com output não-envelope NÃO loga warning', async () => {
      const warnSpy = jest
        .spyOn(
          (confirmationManager as any).logger as { warn: () => void },
          'warn',
        )
        .mockImplementation(() => undefined);

      await confirmationManager.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'query_patients',
        args: {},
        output: 'lista de pacientes em texto livre',
      });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(whatsappConversationRepoMock.update).not.toHaveBeenCalled();

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

      await confirmationManager.trackPendingConfirmation({
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

      await confirmationManager.trackPendingConfirmation({
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

      await confirmationManager.trackPendingConfirmation({
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

      await confirmationManager.trackPendingConfirmation({
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

      await confirmationManager.trackPendingConfirmation({
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

      await confirmationManager.trackPendingConfirmation({
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

      const hint = await confirmationManager.buildPendingConfirmationHint('conv-1', 'Sim');

      expect(hint).toContain('CONFIRMAÇÃO DETERMINÍSTICA');
      expect(hint).toContain('upload_doctor_signature');
      expect(hint).toContain('"confirm":true');
    });

    it('retorna null quando não há pending_confirmation', async () => {
      whatsappConversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      const hint = await confirmationManager.buildPendingConfirmationHint('conv-1', 'Sim');
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

      const hint = await confirmationManager.buildPendingConfirmationHint('conv-1', 'Sim');
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

      const hint = await confirmationManager.buildPendingConfirmationHint('conv-1', 'Não');

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

      const hint = await confirmationManager.buildPendingConfirmationHint(
        'conv-1',
        'na verdade, quero mudar a foto',
      );

      expect(hint).toBeNull();
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
