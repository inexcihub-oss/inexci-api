import { buildFlowDraftTools } from './flow-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('flow-draft tools (Fase 5)', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let mockSurgeryRequestRepo: any;
  let mockWorkflowService: any;
  let mockActivityRepo: any;
  let mockPatientRepo: any;
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
    mockPatientRepo = {
      update: jest.fn().mockResolvedValue(undefined),
    };

    tools = buildFlowDraftTools({
      draftService,
      surgeryRequestRepo: mockSurgeryRequestRepo,
      workflowService: mockWorkflowService,
      activityRepo: mockActivityRepo,
      patientRepo: mockPatientRepo,
    });
  });

  describe('invoice', () => {
    it('fluxo completo: set request/protocol/value/sent_at → preview → commit', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'invoice' });
      await getTool('invoice_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('invoice_draft_set_protocol').execute(
        { invoice_protocol: 'FAT-123' },
        context,
      );
      await getTool('invoice_draft_set_value').execute(
        { invoice_value: 1500 },
        context,
      );
      await getTool('invoice_draft_set_sent_at').execute(
        { invoice_sent_at: '2026-01-10' },
        context,
      );
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

    it('preview falha quando faltam campos', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'invoice' });
      const raw = await getTool('invoice_draft_preview').execute({}, context);
      expect(parseToolResult<any>(raw)?.status).toBe('needs_input');
    });
  });

  describe('contestation', () => {
    it('AUTHORIZATION com method=document não exige to/subject/message', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'contestation',
      });
      await getTool('contestation_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('contestation_draft_set_type').execute(
        { contestation_type: 'AUTHORIZATION' },
        context,
      );
      await getTool('contestation_draft_set_reason').execute(
        { reason: 'Procedimento não autorizado integralmente.' },
        context,
      );
      await getTool('contestation_draft_set_delivery').execute(
        { method: 'document' },
        context,
      );
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

    it('PAYMENT exige to/subject/message no preview', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'contestation',
      });
      await getTool('contestation_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('contestation_draft_set_type').execute(
        { contestation_type: 'PAYMENT' },
        context,
      );
      await getTool('contestation_draft_set_reason').execute(
        { reason: 'Valor recebido divergente do faturado.' },
        context,
      );
      const previewIncomplete = parseToolResult<any>(
        await getTool('contestation_draft_preview').execute({}, context),
      );
      expect(previewIncomplete?.status).toBe('needs_input');
      expect(previewIncomplete?.next_required_fields).toEqual(
        expect.arrayContaining(['to', 'subject', 'message']),
      );

      await getTool('contestation_draft_set_delivery').execute(
        {
          to: 'convenio@x.com',
          subject: 'Contestação',
          message: 'Mensagem',
        },
        context,
      );
      const commitRaw = await getTool('contestation_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(parseToolResult<any>(commitRaw)?.status).toBe('ok');
      expect(mockWorkflowService.contestPayment).toHaveBeenCalled();
    });
  });

  describe('scheduling', () => {
    it('definir 3 datas e commitar chama updateDateOptions', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'scheduling',
      });
      await getTool('scheduling_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('scheduling_draft_set_date_options').execute(
        { date_options: ['2026-02-01', '2026-02-08', '2026-02-15'] },
        context,
      );
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
      await getTool('scheduling_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('scheduling_draft_set_confirmed_date').execute(
        { confirmed_date_index: 1 },
        context,
      );
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

    it('rejeita 4 datas', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'scheduling',
      });
      const raw = await getTool('scheduling_draft_set_date_options').execute(
        {
          date_options: [
            '2026-02-01',
            '2026-02-08',
            '2026-02-15',
            '2026-02-22',
          ],
        },
        context,
      );
      expect(parseToolResult<any>(raw)?.status).toBe('error');
    });
  });

  describe('update_sc', () => {
    it('clinical: rejeita campo fora do schema', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await getTool('update_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('update_sc_draft_set_scope').execute(
        { scope: 'clinical' },
        context,
      );
      const raw = await getTool('update_sc_draft_set_field').execute(
        { field: 'priority', value: 3 },
        context,
      );
      expect(parseToolResult<any>(raw)?.status).toBe('error');
    });

    it('admin: aceita priority e commita via surgeryRequestRepo.update', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await getTool('update_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('update_sc_draft_set_scope').execute(
        { scope: 'admin' },
        context,
      );
      await getTool('update_sc_draft_set_field').execute(
        { field: 'priority', value: 3 },
        context,
      );
      await getTool('update_sc_draft_set_field').execute(
        { field: 'healthPlanProtocol', value: 'XYZ-123' },
        context,
      );
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
      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('sc-1', {
        priority: 3,
        healthPlanProtocol: 'XYZ-123',
      });
    });

    it('patient: roteia para patientRepo.update', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await getTool('update_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('update_sc_draft_set_scope').execute(
        { scope: 'patient' },
        context,
      );
      await getTool('update_sc_draft_set_field').execute(
        { field: 'phone', value: '11912345678' },
        context,
      );
      const commit = parseToolResult<any>(
        await getTool('update_sc_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockPatientRepo.update).toHaveBeenCalledWith('pat-1', {
        phone: '11912345678',
      });
    });

    it('mudar escopo limpa changes anteriores', async () => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await getTool('update_sc_draft_set_request').execute(
        { surgery_request_id_or_protocol: 'SC-0001' },
        context,
      );
      await getTool('update_sc_draft_set_scope').execute(
        { scope: 'clinical' },
        context,
      );
      await getTool('update_sc_draft_set_field').execute(
        { field: 'cidCode', value: 'M17.0' },
        context,
      );
      await getTool('update_sc_draft_set_scope').execute(
        { scope: 'admin' },
        context,
      );
      const current = await draftService.getCurrentOfType(
        'conv-1',
        'update_sc',
      );
      expect(current?.fields.changes).toEqual({});
    });
  });

  describe('guarda', () => {
    it('set_protocol falha quando draft ativo é de outro tipo', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'scheduling',
      });
      const raw = await getTool('invoice_draft_set_protocol').execute(
        { invoice_protocol: 'FAT-X' },
        context,
      );
      expect(parseToolResult<any>(raw)?.status).toBe('blocked');
    });
  });
});
