import { buildFlowDraftTransitionTools } from './flow-draft-transition.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';

describe('flow-draft-transition tools (Fase 6.5)', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let mockSurgeryRequestRepo: any;
  let mockWorkflowService: any;
  let mockActivityRepo: any;
  let mockDocumentRepo: any;
  let mockPendencyValidator: any;
  let tools: ReturnType<typeof buildFlowDraftTransitionTools>;

  const context: ToolContext = {
    userId: 'user-1',
    phone: '+5511999999999',
    accessibleDoctorIds: ['doctor-1'],
    conversationId: 'conv-1',
  };

  const getTool = (name: string) => {
    const t = tools.find((t) => t.name === name);
    if (!t) throw new Error(`Tool não encontrada: ${name}`);
    return t;
  };

  const makeSc = (status: SurgeryRequestStatus) => ({
    id: 'sc-1',
    protocol: 'SC-0001',
    doctorId: 'doctor-1',
    patientId: 'pat-1',
    status,
  });

  beforeEach(() => {
    conv = { id: 'conv-1', operationDraft: null };
    mockConvRepo = {
      findOne: jest.fn().mockImplementation(async () => conv),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        conv = { ...conv, ...patch };
      }),
    };
    draftService = new OperationDraftService(mockConvRepo);

    mockSurgeryRequestRepo = {
      findOneSimple: jest
        .fn()
        .mockResolvedValue(makeSc(SurgeryRequestStatus.PENDING)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    mockWorkflowService = {
      sendRequest: jest.fn().mockResolvedValue(undefined),
      startAnalysis: jest.fn().mockResolvedValue(undefined),
      acceptAuthorization: jest.fn().mockResolvedValue(undefined),
      markPerformed: jest.fn().mockResolvedValue(undefined),
    };
    mockActivityRepo = { create: jest.fn().mockResolvedValue(undefined) };
    mockDocumentRepo = { findMany: jest.fn().mockResolvedValue([]) };
    mockPendencyValidator = {
      getSummary: jest.fn().mockResolvedValue({
        canAdvance: true,
        items: [],
        pending: 0,
        total: 0,
      }),
    };

    tools = buildFlowDraftTransitionTools({
      draftService,
      surgeryRequestRepo: mockSurgeryRequestRepo,
      workflowService: mockWorkflowService,
      activityRepo: mockActivityRepo,
      documentRepo: mockDocumentRepo,
      pendencyValidator: mockPendencyValidator,
    });
  });

  describe('send_sc (PENDING → SENT)', () => {
    beforeEach(async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(
        makeSc(SurgeryRequestStatus.PENDING),
      );
      await draftService.start({ conversationId: 'conv-1', type: 'send_sc' });
    });

    it('fluxo completo: download → preview → commit', async () => {
      await getTool('send_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('send_sc_draft_set_method').execute(
        { method: 'download' },
        context,
      );
      const previewRaw = await getTool('send_sc_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commitRaw = await getTool('send_sc_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.sendRequest).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({ method: 'download' }),
        'user-1',
      );
    });

    it('email exige `to` e `subject`', async () => {
      await getTool('send_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('send_sc_draft_set_method').execute(
        { method: 'email' },
        context,
      );
      const previewRaw = await getTool('send_sc_draft_preview').execute(
        {},
        context,
      );
      const preview = parseToolResult<any>(previewRaw);
      expect(preview?.status).toBe('needs_input');
      expect(preview?.next_required_fields).toEqual(
        expect.arrayContaining(['to', 'subject']),
      );
    });

    it('bloqueia preview quando há pendências bloqueantes', async () => {
      mockPendencyValidator.getSummary.mockResolvedValue({
        canAdvance: false,
        pending: 1,
        total: 1,
        items: [
          {
            key: 'tuss_procedures',
            label: 'Procedimentos TUSS',
            blocking: true,
            resolved: false,
            responsibleRole: 'collaborator',
          },
        ],
      });
      await getTool('send_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('send_sc_draft_set_method').execute(
        { method: 'download' },
        context,
      );
      const previewRaw = await getTool('send_sc_draft_preview').execute(
        {},
        context,
      );
      const preview = parseToolResult<any>(previewRaw);
      expect(preview?.status).toBe('blocked');
      expect(preview?.message).toMatch(/Procedimentos TUSS/);
    });

    it('commit falha se a SC saiu do status PENDING', async () => {
      await getTool('send_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('send_sc_draft_set_method').execute(
        { method: 'download' },
        context,
      );
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(
        makeSc(SurgeryRequestStatus.SENT),
      );
      const commitRaw = await getTool('send_sc_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('blocked');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
    });
  });

  describe('start_analysis (SENT → IN_ANALYSIS)', () => {
    beforeEach(async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(
        makeSc(SurgeryRequestStatus.SENT),
      );
      await draftService.start({
        conversationId: 'conv-1',
        type: 'start_analysis',
      });
    });

    it('fluxo completo: request + número + data → commit', async () => {
      await getTool('start_analysis_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('start_analysis_draft_set_request_number').execute(
        { request_number: 'OPE-99' },
        context,
      );
      await getTool('start_analysis_draft_set_received_at').execute(
        { received_at: '2026-02-01' },
        context,
      );
      const commitRaw = await getTool('start_analysis_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.startAnalysis).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({
          requestNumber: 'OPE-99',
          receivedAt: '2026-02-01',
        }),
        'user-1',
      );
    });

    it('preview pede campos faltantes', async () => {
      await getTool('start_analysis_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const previewRaw = await getTool('start_analysis_draft_preview').execute(
        {},
        context,
      );
      const preview = parseToolResult<any>(previewRaw);
      expect(preview?.status).toBe('needs_input');
      expect(preview?.next_required_fields).toEqual(
        expect.arrayContaining(['requestNumber', 'receivedAt']),
      );
    });

    it('cotação opcional vinculada ao slot 1', async () => {
      await getTool('start_analysis_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('start_analysis_draft_set_request_number').execute(
        { request_number: 'OPE-99' },
        context,
      );
      await getTool('start_analysis_draft_set_received_at').execute(
        { received_at: '2026-02-01' },
        context,
      );
      await getTool('start_analysis_draft_set_quotation').execute(
        { slot: 1, number: 'COT-1', received_at: '2026-02-02' },
        context,
      );
      await getTool('start_analysis_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(mockWorkflowService.startAnalysis).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({
          quotation1Number: 'COT-1',
          quotation1ReceivedAt: '2026-02-02',
        }),
        'user-1',
      );
    });
  });

  describe('accept_authorization (IN_ANALYSIS → IN_SCHEDULING)', () => {
    beforeEach(async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(
        makeSc(SurgeryRequestStatus.IN_ANALYSIS),
      );
      await draftService.start({
        conversationId: 'conv-1',
        type: 'accept_authorization',
      });
    });

    it('fluxo completo: 2 datas → commit', async () => {
      await getTool('accept_authorization_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('accept_authorization_draft_set_date_options').execute(
        { date_options: ['2026-03-01', '2026-03-08'] },
        context,
      );
      const commitRaw = await getTool(
        'accept_authorization_draft_commit',
      ).execute({ confirm: true }, context);
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.acceptAuthorization).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({
          dateOptions: ['2026-03-01', '2026-03-08'],
        }),
        'user-1',
      );
    });

    it('rejeita lista vazia ou maior que 3', async () => {
      await getTool('accept_authorization_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const empty = await getTool(
        'accept_authorization_draft_set_date_options',
      ).execute({ date_options: [] }, context);
      expect(parseToolResult<any>(empty)?.status).toBe('error');

      const tooMany = await getTool(
        'accept_authorization_draft_set_date_options',
      ).execute(
        {
          date_options: [
            '2026-03-01',
            '2026-03-02',
            '2026-03-03',
            '2026-03-04',
          ],
        },
        context,
      );
      expect(parseToolResult<any>(tooMany)?.status).toBe('error');
    });

    it('rejeita data em formato inválido', async () => {
      await getTool('accept_authorization_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const bad = await getTool(
        'accept_authorization_draft_set_date_options',
      ).execute({ date_options: ['01/03/2026'] }, context);
      expect(parseToolResult<any>(bad)?.status).toBe('error');
    });
  });

  describe('mark_performed (SCHEDULED → PERFORMED)', () => {
    beforeEach(async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(
        makeSc(SurgeryRequestStatus.SCHEDULED),
      );
      await draftService.start({
        conversationId: 'conv-1',
        type: 'mark_performed',
      });
    });

    it('check_docs reporta documentos faltantes', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        { id: 'd1', key: 'surgery_room' },
      ]);
      await getTool('mark_performed_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const raw = await getTool('mark_performed_draft_check_docs').execute(
        {},
        context,
      );
      const result = parseToolResult<any>(raw);
      expect(result?.status).toBe('needs_input');
      expect(result?.data?.missing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'surgery_auth_document' }),
        ]),
      );
    });

    it('preview bloqueia quando documentos obrigatórios faltam', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([]);
      await getTool('mark_performed_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('mark_performed_draft_set_performed_at').execute(
        { performed_at: '2026-04-01' },
        context,
      );
      const previewRaw = await getTool('mark_performed_draft_preview').execute(
        {},
        context,
      );
      const preview = parseToolResult<any>(previewRaw);
      expect(preview?.status).toBe('blocked');
      expect(preview?.message).toMatch(/Ficha da sala/);
      expect(preview?.message).toMatch(/Documento de autorização/);
    });

    it('commit autoriza e avança quando todos os docs obrigatórios estão presentes', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        { id: 'd1', key: 'surgery_room' },
        { id: 'd2', key: 'surgery_auth_document' },
      ]);
      await getTool('mark_performed_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('mark_performed_draft_set_performed_at').execute(
        { performed_at: '2026-04-01' },
        context,
      );
      const commitRaw = await getTool('mark_performed_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.markPerformed).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({ surgeryPerformedAt: '2026-04-01' }),
        'user-1',
      );
    });

    it('commit bloqueia quando faltam documentos mesmo com confirm=true', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        { id: 'd1', key: 'surgery_room' },
      ]);
      await getTool('mark_performed_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('mark_performed_draft_set_performed_at').execute(
        { performed_at: '2026-04-01' },
        context,
      );
      const commitRaw = await getTool('mark_performed_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('blocked');
      expect(mockWorkflowService.markPerformed).not.toHaveBeenCalled();
    });

    it('rejeita data inválida em performed_at', async () => {
      await getTool('mark_performed_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const raw = await getTool(
        'mark_performed_draft_set_performed_at',
      ).execute({ performed_at: 'ontem' }, context);
      expect(parseToolResult<any>(raw)?.status).toBe('error');
    });
  });

  describe('guarda de tipo de draft', () => {
    it('block quando não há draft ativo', async () => {
      const raw = await getTool('send_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const result = parseToolResult<any>(raw);
      expect(result?.status).toBe('blocked');
    });

    it('block quando o draft ativo é de outro tipo', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'start_analysis',
      });
      const raw = await getTool('send_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      const result = parseToolResult<any>(raw);
      expect(result?.status).toBe('blocked');
      expect(result?.message).toMatch(/start_analysis/);
    });
  });
});
