import {
  ConfirmationManagerService,
  inferDraftPendingTarget,
  TOOL_DISPLAY_LABELS,
} from './confirmation-manager.service';
import { buildToolResult } from '../../tools/tool-result';

describe('ConfirmationManagerService', () => {
  const conversationRepoMock = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const conversationServiceMock = {
    loadRecentForLlm: jest.fn(),
  };

  let service: ConfirmationManagerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConfirmationManagerService(
      conversationRepoMock as any,
      conversationServiceMock as any,
    );
  });

  describe('parseAffirmativeConfirmation', () => {
    it.each([
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
      'beleza',
      'show',
      'quero sim',
      // retry phrases
      'tente novamente',
      'Tente novamente',
      'tenta novamente',
      'tente de novo',
      'tentar novamente',
      'crie',
      'criar',
    ])('aceita "%s"', (input) => {
      expect(service.parseAffirmativeConfirmation(input)).toBe(true);
    });

    it.each(['', 'qualquer coisa', 'me ajude com a sc'])(
      'rejeita "%s"',
      (input) => {
        expect(service.parseAffirmativeConfirmation(input)).toBe(false);
      },
    );

    it('rejeita textos longos (> 60 chars) mesmo com sim no início', () => {
      expect(service.parseAffirmativeConfirmation('a'.repeat(61))).toBe(false);
    });
  });

  describe('parseNegativeConfirmation', () => {
    it.each([
      'nao',
      'não',
      'cancela',
      'cancelar',
      'pare',
      'desiste',
      'esquece',
      'deixa pra la',
    ])('aceita "%s"', (input) => {
      expect(service.parseNegativeConfirmation(input)).toBe(true);
    });

    it('rejeita confirmações afirmativas', () => {
      expect(service.parseNegativeConfirmation('sim')).toBe(false);
    });
  });

  describe('parseNumericChoice', () => {
    it.each([
      ['1', 1],
      ['2', 2],
      ['9', 9],
      ['opção 3', 3],
      ['opcao 4', 4],
      ['quero 1', 1],
      ['quero a 2', 2],
      ['vai na 3', 3],
      ['um', 1],
      ['dois', 2],
      ['tres', 3],
    ] as const)('aceita "%s" → %d', (input, expected) => {
      expect(service.parseNumericChoice(input)).toBe(expected);
    });

    it.each(['0', '10', 'sim', '', 'qualquer coisa'])(
      'rejeita "%s"',
      (input) => {
        expect(service.parseNumericChoice(input)).toBeNull();
      },
    );
  });

  describe('isPendingConfirmationFresh', () => {
    it('considera fresh quando criado há menos de 15 min', () => {
      const recent = new Date(Date.now() - 60_000).toISOString();
      expect(service.isPendingConfirmationFresh(recent)).toBe(true);
    });

    it('considera expirado quando criado há mais de 15 min', () => {
      const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
      expect(service.isPendingConfirmationFresh(old)).toBe(false);
    });

    it('rejeita inputs inválidos', () => {
      expect(service.isPendingConfirmationFresh(undefined)).toBe(false);
      expect(service.isPendingConfirmationFresh('not-a-date')).toBe(false);
      expect(service.isPendingConfirmationFresh(123 as any)).toBe(false);
    });
  });

  describe('isMutationConfirmableTool', () => {
    it('aceita qualquer *_draft_preview ou *_draft_commit', () => {
      expect(service.isMutationConfirmableTool('sc_draft_preview')).toBe(true);
      expect(service.isMutationConfirmableTool('patient_draft_commit')).toBe(
        true,
      );
    });

    it('aceita tools mapeadas em TOOL_DISPLAY_LABELS (ex.: upload_doctor_signature)', () => {
      expect(service.isMutationConfirmableTool('upload_doctor_signature')).toBe(
        true,
      );
    });

    it('rejeita tools de leitura', () => {
      expect(service.isMutationConfirmableTool('list_patients')).toBe(false);
      expect(service.isMutationConfirmableTool('search_tuss_codes')).toBe(
        false,
      );
    });
  });

  describe('inferDraftPendingTarget (helper)', () => {
    it('preview → commit com confirm:true', () => {
      const out = inferDraftPendingTarget('sc_draft_preview', { foo: 1 });
      expect(out).toEqual({
        tool: 'sc_draft_commit',
        args: { confirm: true },
      });
    });

    it('commit → mesma tool com args + confirm:true', () => {
      const out = inferDraftPendingTarget('sc_draft_commit', { foo: 1 });
      expect(out).toEqual({
        tool: 'sc_draft_commit',
        args: { foo: 1, confirm: true },
      });
    });

    it('retorna null para nomes fora do padrão', () => {
      expect(inferDraftPendingTarget('list_patients', {})).toBeNull();
    });
  });

  describe('setPendingConfirmation / clearPendingConfirmation', () => {
    it('grava patch com createdAt', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await service.setPendingConfirmation('conv-1', {
        tool: 'sc_draft_commit',
        args: { foo: 1 },
        description: 'criar a SC',
      });

      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: expect.objectContaining({
              tool: 'sc_draft_commit',
              args: { foo: 1 },
              description: 'criar a SC',
              createdAt: expect.any(String),
            }),
          }),
        }),
      );
    });

    it('clear grava pending_confirmation = null', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: { pending_confirmation: { foo: 1 } },
      });

      await service.clearPendingConfirmation('conv-1');

      expect(conversationRepoMock.update).toHaveBeenCalledWith('conv-1', {
        conversationMemory: expect.objectContaining({
          pending_confirmation: null,
        }),
      });
    });
  });

  describe('trackPendingConfirmation', () => {
    it('limpa pending quando ToolResult.status === ok e a tool é confirmável', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: { pending_confirmation: { tool: 'x' } },
      });

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'sc_draft_commit',
        args: { confirm: true },
        output: buildToolResult({
          status: 'ok',
          message: 'SC criada com sucesso',
        }),
      });

      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: null,
          }),
        }),
      );
    });

    it('NÃO limpa pending quando tool é leitura (não-confirmável)', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'list_patients',
        args: {},
        output: buildToolResult({ status: 'ok', message: 'ok' }),
      });

      expect(conversationRepoMock.update).not.toHaveBeenCalled();
    });

    // Regressão 2026-05-14: tools de leitura como `query_surgery_requests`
    // devolvem string crua (não envelope ToolResult), e o
    // `trackPendingConfirmation` logava warning `envelope_missing` em toda
    // consulta, poluindo o log. Solução: pular cedo se não for confirmável.
    it('NÃO loga warning envelope_missing quando tool de leitura devolve string crua', async () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'query_surgery_requests',
        args: {},
        output: 'Suas solicitações por status:\n\n*Pendente*\nSC-0042 — Maria',
      });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(conversationRepoMock.update).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('grava pending quando ToolResult.status === pending_confirmation (caminho moderno)', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'sc_draft_preview',
        args: { foo: 1 },
        output: buildToolResult({
          status: 'pending_confirmation',
          message: 'Confirme',
          pendingConfirmation: {
            tool: 'sc_draft_commit',
            args: { foo: 1 },
            description: 'criar a SC',
          },
        }),
      });

      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: expect.objectContaining({
              tool: 'sc_draft_commit',
              args: { foo: 1, confirm: true },
              description: 'criar a SC',
            }),
          }),
        }),
      );
    });

    it('grava pending quando upload_doctor_signature devolve envelope pending_confirmation', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: {},
        output: buildToolResult({
          status: 'pending_confirmation',
          message: 'Aguardando confirmação',
          pendingConfirmation: {
            tool: 'upload_doctor_signature',
            args: { confirm: true },
            description: TOOL_DISPLAY_LABELS['upload_doctor_signature'],
          },
        }),
      });

      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: expect.objectContaining({
              tool: 'upload_doctor_signature',
              args: { confirm: true },
              description: TOOL_DISPLAY_LABELS['upload_doctor_signature'],
            }),
          }),
        }),
      );
    });

    it('limpa pending quando upload_doctor_signature devolve envelope ok', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: { pending_confirmation: { tool: 'x' } },
      });

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: { confirm: true },
        output: buildToolResult({
          status: 'ok',
          message: 'Assinatura atualizada',
        }),
      });

      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: null,
          }),
        }),
      );
    });

    it('quando envelope falha (texto livre) loga warning e NÃO mexe no pending', async () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.trackPendingConfirmation({
        conversationId: 'conv-1',
        toolName: 'upload_doctor_signature',
        args: {},
        output: 'Texto livre legado sem envelope',
      });

      expect(conversationRepoMock.update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('envelope_missing'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('buildPendingConfirmationHint', () => {
    it('retorna null quando input não é afirmativo nem negativo', async () => {
      const out = await service.buildPendingConfirmationHint(
        'conv-1',
        'me explica isso',
      );
      expect(out).toBeNull();
    });

    it('retorna null quando não há pending no memory', async () => {
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {},
      });
      const out = await service.buildPendingConfirmationHint('conv-1', 'sim');
      expect(out).toBeNull();
    });

    it('retorna hint determinístico quando pending fresh + sim', async () => {
      const createdAt = new Date(Date.now() - 60_000).toISOString();
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'sc_draft_commit',
            args: { foo: 1 },
            description: 'criar a SC',
            createdAt,
          },
        },
      });

      const out = await service.buildPendingConfirmationHint('conv-1', 'sim');
      expect(out).toContain('CONFIRMAÇÃO DETERMINÍSTICA');
      expect(out).toContain('sc_draft_commit');
      expect(out).toContain('"confirm":true');
    });

    it('retorna hint de cancelamento + limpa pending quando usuário diz não', async () => {
      const createdAt = new Date(Date.now() - 60_000).toISOString();
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'sc_draft_commit',
            args: { foo: 1 },
            createdAt,
          },
        },
      });

      const out = await service.buildPendingConfirmationHint('conv-1', 'nao');
      expect(out).toContain('CANCELAMENTO DETERMINÍSTICO');
      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: null,
          }),
        }),
      );
    });

    it('expira pending antigo (> 15 min) e retorna null', async () => {
      const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
      conversationRepoMock.findOne.mockResolvedValue({
        id: 'conv-1',
        conversationMemory: {
          pending_confirmation: {
            tool: 'sc_draft_commit',
            args: { foo: 1 },
            createdAt: oldCreatedAt,
          },
        },
      });

      const out = await service.buildPendingConfirmationHint('conv-1', 'sim');
      expect(out).toBeNull();
      // E limpa o pending expirado.
      expect(conversationRepoMock.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            pending_confirmation: null,
          }),
        }),
      );
    });
  });

  describe('buildNumericChoiceHint', () => {
    it('retorna null se input não é escolha numérica', async () => {
      expect(
        await service.buildNumericChoiceHint('conv-1', 'me ajude com algo'),
      ).toBeNull();
    });

    it('retorna null quando o histórico não tem opções numeradas', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        { role: 'assistant', content: 'Texto sem opções.' },
      ]);
      expect(await service.buildNumericChoiceHint('conv-1', '2')).toBeNull();
    });

    it('monta hint com a opção escolhida quando dígito casa', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        { role: 'assistant', content: '1 - criar SC\n2 - ver pacientes' },
      ]);
      const hint = await service.buildNumericChoiceHint('conv-1', '2');
      expect(hint).toContain('OPÇÃO 2');
      expect(hint).toContain('ver pacientes');
    });

    it('avisa quando dígito não está nas opções disponíveis', async () => {
      conversationServiceMock.loadRecentForLlm.mockResolvedValue([
        { role: 'assistant', content: '1 - criar SC\n2 - ver pacientes' },
      ]);
      const hint = await service.buildNumericChoiceHint('conv-1', '7');
      expect(hint).toContain('só ofereceu as opções 1/2');
    });
  });
});
