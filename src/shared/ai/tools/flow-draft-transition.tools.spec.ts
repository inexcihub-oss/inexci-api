import { buildFlowDraftTransitionTools } from './flow-draft-transition.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';

describe('flow-draft-transition tools (preview + commit + check_docs)', () => {
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

  it('expõe apenas preview/commit por transição (mais check_docs no mark_performed)', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'send_sc_draft_preview',
      'send_sc_draft_commit',
      'start_analysis_draft_preview',
      'start_analysis_draft_commit',
      'accept_authorization_draft_preview',
      'accept_authorization_draft_commit',
      'mark_performed_draft_check_docs',
      'mark_performed_draft_preview',
      'mark_performed_draft_commit',
    ]);
  });

  describe('send_sc (PENDING → SENT)', () => {
    beforeEach(async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(
        makeSc(SurgeryRequestStatus.PENDING),
      );
      await draftService.start({ conversationId: 'conv-1', type: 'send_sc' });
    });

    it('fluxo completo: setFields → preview → commit (download)', async () => {
      await draftService.setFields('conv-1', 'send_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        method: 'download',
      });

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
      await draftService.setFields('conv-1', 'send_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        method: 'email',
      });
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
      await draftService.setFields('conv-1', 'send_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        method: 'download',
      });
      const previewRaw = await getTool('send_sc_draft_preview').execute(
        {},
        context,
      );
      const preview = parseToolResult<any>(previewRaw);
      expect(preview?.status).toBe('blocked');
      expect(preview?.message).toMatch(/Procedimentos TUSS/);
    });

    it('commit falha se a SC saiu do status PENDING', async () => {
      await draftService.setFields('conv-1', 'send_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        method: 'download',
      });
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

    it('fluxo completo: setFields + commit dispara startAnalysis', async () => {
      await draftService.setFields('conv-1', 'start_analysis', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        requestNumber: 'OPE-99',
        receivedAt: '2026-02-01',
      });

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
      await draftService.setFields('conv-1', 'start_analysis', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
      });
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
      await draftService.setFields('conv-1', 'start_analysis', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        requestNumber: 'OPE-99',
        receivedAt: '2026-02-01',
        quotation1Number: 'COT-1',
        quotation1ReceivedAt: '2026-02-02',
      });
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
      await draftService.setFields('conv-1', 'accept_authorization', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        dateOptions: ['2026-03-01', '2026-03-08'],
      });
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

    it('check_docs reporta documentos faltantes como recomendados', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        { id: 'd1', key: 'surgery_room' },
      ]);
      await draftService.setFields('conv-1', 'mark_performed', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
      });
      const raw = await getTool('mark_performed_draft_check_docs').execute(
        {},
        context,
      );
      const result = parseToolResult<any>(raw);
      expect(result?.status).toBe('ok');
      expect(result?.data?.missing).toEqual([]);
    });

    it('check_docs sem surgeryRequestId pede draft_update', async () => {
      const raw = await getTool('mark_performed_draft_check_docs').execute(
        {},
        context,
      );
      const result = parseToolResult<any>(raw);
      expect(result?.status).toBe('needs_input');
      expect(result?.message).toMatch(/draft_update/);
    });

    it('preview segue mesmo sem documentos anexados', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([]);
      await draftService.setFields('conv-1', 'mark_performed', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        surgeryPerformedAt: '2026-04-01',
      });
      const previewRaw = await getTool('mark_performed_draft_preview').execute(
        {},
        context,
      );
      const preview = parseToolResult<any>(previewRaw);
      expect(preview?.status).toBe('pending_confirmation');
    });

    it('commit autoriza e avança sem documentos anexados', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([]);
      await draftService.setFields('conv-1', 'mark_performed', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        surgeryPerformedAt: '2026-04-01',
      });
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

    it('commit autoriza e avança quando documentos estão presentes', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        { id: 'd1', key: 'surgery_room' },
        { id: 'd2', key: 'surgery_auth_document' },
      ]);
      await draftService.setFields('conv-1', 'mark_performed', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        surgeryPerformedAt: '2026-04-01',
      });
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
  });
});
