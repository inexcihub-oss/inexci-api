import { buildFlowDraftTools } from './flow-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('flow-draft tools (preview + commit)', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let mockSurgeryRequestRepo: any;
  let mockWorkflowService: any;
  let mockActivityRepo: any;
  let mockPatientsService: any;
  let mockSurgeryRequestsService: any;
  let tools: ReturnType<typeof buildFlowDraftTools>;

  const context: ToolContext = {
    userId: 'user-1',
    phone: '+5511999999999',
    accessibleDoctorIds: ['doctor-1'],
    conversationId: 'conv-1',
  };

  const getTool = (name: string) => tools.find((t) => t.name === name)!;

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
      findOneSimple: jest.fn().mockResolvedValue({
        id: 'sc-1',
        protocol: 'SC-0001',
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        status: 7,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    mockWorkflowService = {
      invoiceRequest: jest.fn().mockResolvedValue(undefined),
      contestAuthorization: jest.fn().mockResolvedValue(undefined),
      contestPayment: jest.fn().mockResolvedValue(undefined),
      updateDateOptions: jest.fn().mockResolvedValue(undefined),
      confirmDate: jest.fn().mockResolvedValue(undefined),
    };
    mockActivityRepo = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockPatientsService = {
      update: jest.fn().mockResolvedValue(undefined),
    };
    mockSurgeryRequestsService = {
      update: jest.fn().mockResolvedValue(undefined),
    };

    tools = buildFlowDraftTools({
      draftService,
      surgeryRequestRepo: mockSurgeryRequestRepo,
      workflowService: mockWorkflowService,
      activityRepo: mockActivityRepo,
      patientsService: mockPatientsService,
      surgeryRequestsService: mockSurgeryRequestsService,
    });
  });

  it('expõe apenas preview e commit por fluxo (setters/status/cancel migrados para draft_update/draft_status/draft_cancel)', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'invoice_draft_preview',
      'invoice_draft_commit',
      'contestation_draft_preview',
      'contestation_draft_commit',
      'scheduling_draft_preview',
      'scheduling_draft_commit',
      'update_sc_draft_preview',
      'update_sc_draft_commit',
    ]);
  });

  describe('invoice', () => {
    it('preview falha quando faltam campos', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'invoice' });
      const raw = await getTool('invoice_draft_preview').execute({}, context);
      expect(parseToolResult<any>(raw)?.status).toBe('needs_input');
    });

    it('fluxo completo via setFields → preview → commit dispara invoiceRequest', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'invoice' });
      await draftService.setFields('conv-1', 'invoice', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        invoiceProtocol: 'FAT-123',
        invoiceValue: 1500,
        invoiceSentAt: '2026-01-10',
      });

      const previewRaw = await getTool('invoice_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commitRaw = await getTool('invoice_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.invoiceRequest).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({
          invoiceProtocol: 'FAT-123',
          invoiceValue: 1500,
          invoiceSentAt: '2026-01-10',
        }),
        'user-1',
      );
      expect(conv.operationDraft).toBeNull();
    });

    it('commit propaga setAsDefaultForHealthPlan ao workflow', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'invoice' });
      await draftService.setFields('conv-1', 'invoice', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        invoiceProtocol: 'FAT-456',
        invoiceValue: 250,
        invoiceSentAt: '2026-02-15',
        paymentDeadline: '2026-03-15',
        setAsDefaultForHealthPlan: true,
      });

      const commitRaw = await getTool('invoice_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(parseToolResult<any>(commitRaw)?.status).toBe('ok');
      expect(mockWorkflowService.invoiceRequest).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({
          paymentDeadline: '2026-03-15',
          setAsDefaultForHealthPlan: true,
        }),
        'user-1',
      );
    });
  });

  describe('contestation', () => {
    it('AUTHORIZATION com method=document commita via contestAuthorization', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'contestation',
      });
      await draftService.setFields('conv-1', 'contestation', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        contestationType: 'AUTHORIZATION',
        reason: 'Procedimento não autorizado integralmente.',
        method: 'document',
      });

      const previewRaw = await getTool('contestation_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commitRaw = await getTool('contestation_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(parseToolResult<any>(commitRaw)?.status).toBe('ok');
      expect(mockWorkflowService.contestAuthorization).toHaveBeenCalled();
    });

    it('PAYMENT exige to/subject/message e commita via contestPayment', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'contestation',
      });
      await draftService.setFields('conv-1', 'contestation', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        contestationType: 'PAYMENT',
        reason: 'Valor recebido divergente do faturado.',
      });

      const previewIncomplete = parseToolResult<any>(
        await getTool('contestation_draft_preview').execute({}, context),
      );
      expect(previewIncomplete?.status).toBe('needs_input');
      expect(previewIncomplete?.next_required_fields).toEqual(
        expect.arrayContaining(['to', 'subject', 'message']),
      );

      await draftService.setFields('conv-1', 'contestation', {
        method: 'email',
        to: 'fin@plano.com',
        subject: 'Contestação',
        message: 'Mensagem',
        attachments: ['doc-1', 'doc-2'],
      });

      const commitRaw = await getTool('contestation_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(parseToolResult<any>(commitRaw)?.status).toBe('ok');
      expect(mockWorkflowService.contestPayment).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({
          to: 'fin@plano.com',
          subject: 'Contestação',
          message: 'Mensagem',
          attachments: ['doc-1', 'doc-2'],
        }),
        'user-1',
      );
    });

    it('AUTHORIZATION com method=email exige to/subject/message no preview', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'contestation',
      });
      await draftService.setFields('conv-1', 'contestation', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        contestationType: 'AUTHORIZATION',
        reason: 'Negativa parcial — exige resposta por e-mail.',
        method: 'email',
      });
      const previewRaw = await getTool('contestation_draft_preview').execute(
        {},
        context,
      );
      const parsed = parseToolResult<any>(previewRaw);
      expect(parsed?.status).toBe('needs_input');
      expect(parsed?.next_required_fields).toEqual(
        expect.arrayContaining(['to', 'subject', 'message']),
      );
    });
  });

  describe('scheduling', () => {
    it('definir 3 datas e commitar chama updateDateOptions', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'scheduling',
      });
      await draftService.setFields('conv-1', 'scheduling', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        dateOptions: ['2026-02-01', '2026-02-08', '2026-02-15'],
      });

      const previewRaw = await getTool('scheduling_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commit = parseToolResult<any>(
        await getTool('scheduling_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.updateDateOptions).toHaveBeenCalledWith(
        'sc-1',
        { dateOptions: ['2026-02-01', '2026-02-08', '2026-02-15'] },
        'user-1',
      );
    });

    it('confirmar índice 1 chama confirmDate', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'scheduling',
      });
      await draftService.setFields('conv-1', 'scheduling', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        confirmedDateIndex: 1,
      });

      const commit = parseToolResult<any>(
        await getTool('scheduling_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'sc-1',
        { selectedDateIndex: 1 },
        'user-1',
      );
    });

    it('preview pede entrada quando faltam dateOptions e confirmedDate', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'scheduling',
      });
      await draftService.setFields('conv-1', 'scheduling', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
      });
      const raw = await getTool('scheduling_draft_preview').execute(
        {},
        context,
      );
      const parsed = parseToolResult<any>(raw);
      expect(parsed?.status).toBe('needs_input');
      expect(parsed?.next_required_fields).toEqual(
        expect.arrayContaining(['dateOptions', 'confirmedDateIndex']),
      );
    });
  });

  describe('update_sc', () => {
    it('admin: aceita priority e commita via surgeryRequestsService.update', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await draftService.setFields('conv-1', 'update_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        scope: 'admin',
        changes: { priority: 3, healthPlanProtocol: 'XYZ-123' },
      });

      const previewRaw = await getTool('update_sc_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commit = parseToolResult<any>(
        await getTool('update_sc_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockSurgeryRequestsService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sc-1',
          priority: 3,
          healthPlanProtocol: 'XYZ-123',
        }),
        'user-1',
      );
    });

    it('patient: roteia para patientsService.update', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await draftService.setFields('conv-1', 'update_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        scope: 'patient',
        changes: { phone: '11912345678' },
      });

      const commit = parseToolResult<any>(
        await getTool('update_sc_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockPatientsService.update).toHaveBeenCalledWith(
        'pat-1',
        { phone: '11912345678' },
        'user-1',
      );
    });

    it('commit sem confirm retorna pending_confirmation', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await draftService.setFields('conv-1', 'update_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        scope: 'admin',
        changes: { priority: 2 },
      });
      const raw = await getTool('update_sc_draft_commit').execute(
        { confirm: false },
        context,
      );
      expect(parseToolResult<any>(raw)?.status).toBe('pending_confirmation');
    });

    it('commit sem nenhuma alteração informada bloqueia', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await draftService.setFields('conv-1', 'update_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        scope: 'admin',
        changes: {},
      });
      const raw = await getTool('update_sc_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(['error', 'blocked']).toContain(parseToolResult<any>(raw)?.status);
    });
  });
});
