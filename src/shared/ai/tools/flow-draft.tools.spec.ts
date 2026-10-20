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
      upsertReportSectionByTitle: jest.fn().mockResolvedValue(undefined),
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
    const setUpdateSc = async (scope: string, changes: unknown) => {
      await draftService.start({ conversationId: 'conv-1', type: 'update_sc' });
      await draftService.setFields('conv-1', 'update_sc', {
        surgeryRequestId: 'sc-1',
        surgeryRequestLabel: 'SC-0001',
        scope,
        changes,
      } as never);
    };

    const commitUpdateSc = async () =>
      parseToolResult<any>(
        await getTool('update_sc_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );

    it('admin: aceita priority e commita via surgeryRequestsService.update', async () => {
      await setUpdateSc('admin', {
        priority: 3,
        healthPlanRegistration: '123',
      });

      const previewRaw = await getTool('update_sc_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commit = await commitUpdateSc();
      expect(commit?.status).toBe('ok');
      expect(mockSurgeryRequestsService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sc-1',
          priority: 3,
          healthPlanRegistration: '123',
        }),
        'user-1',
      );
    });

    it('admin: descarta chaves fora da allowlist e informa quais foram ignoradas', async () => {
      await setUpdateSc('admin', {
        priority: 'HIGH',
        status: 9,
        ownerId: 'outro-owner',
        doctorId: 'outro-medico',
        patientId: 'outro-paciente',
        createdById: 'x',
        protocol: 'SC-FAKE',
        healthPlanProtocol: 'XYZ-123',
      });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('ok');
      const [dto] = mockSurgeryRequestsService.update.mock.calls[0];
      expect({ ...dto }).toEqual({ id: 'sc-1', priority: 3 });
      expect(commit?.data.ignoredFields).toEqual([
        'status',
        'ownerId',
        'doctorId',
        'patientId',
        'createdById',
        'protocol',
        'healthPlanProtocol',
      ]);
      expect(commit?.message).toContain('Campos ignorados');
      expect(mockActivityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('status'),
        }),
      );
    });

    it('admin: só chaves proibidas → erro sem chamar o service', async () => {
      await setUpdateSc('admin', { status: 9, ownerId: 'x' });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('error');
      expect(commit?.data.ignoredFields).toEqual(['status', 'ownerId']);
      expect(mockSurgeryRequestsService.update).not.toHaveBeenCalled();
      expect(mockActivityRepo.create).not.toHaveBeenCalled();
      expect(conv.operationDraft).not.toBeNull();
    });

    it('admin: chave de outro escopo (cidCode) é ignorada', async () => {
      await setUpdateSc('admin', { cidCode: 'M17', healthPlanType: 'Apto' });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('ok');
      const [dto] = mockSurgeryRequestsService.update.mock.calls[0];
      expect({ ...dto }).toEqual({ id: 'sc-1', healthPlanType: 'Apto' });
      expect(commit?.data.ignoredFields).toEqual(['cidCode']);
    });

    it('admin: prioridade inválida devolve erro amigável', async () => {
      await setUpdateSc('admin', { priority: 'altíssima' });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('error');
      expect(commit?.message).toContain('priority');
      expect(mockSurgeryRequestsService.update).not.toHaveBeenCalled();
    });

    it('admin: tipo inválido é barrado pelo class-validator', async () => {
      await setUpdateSc('admin', { healthPlanRegistration: { $ne: 1 } });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('error');
      expect(commit?.message).toContain('healthPlanRegistration inválido');
      expect(mockSurgeryRequestsService.update).not.toHaveBeenCalled();
    });

    it('clinical: aplica cidCode e seções, ignora status/doctorId', async () => {
      await setUpdateSc('clinical', {
        cidCode: 'M17.1',
        diagnosis: 'Gonartrose',
        status: 6,
        doctorId: 'outro-medico',
      });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('ok');
      const [dto] = mockSurgeryRequestsService.update.mock.calls[0];
      expect(dto).toMatchObject({ id: 'sc-1', cid: { code: 'M17.1' } });
      expect(dto).not.toHaveProperty('status');
      expect(dto).not.toHaveProperty('doctorId');
      expect(
        mockSurgeryRequestsService.upsertReportSectionByTitle,
      ).toHaveBeenCalledWith('sc-1', 'Diagnóstico e Indicação', 'Gonartrose');
      expect(commit?.data.ignoredFields).toEqual(['status', 'doctorId']);
    });

    it('clinical: cidCode não-string é recusado', async () => {
      await setUpdateSc('clinical', { cidCode: { code: 'M17' } });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('error');
      expect(mockSurgeryRequestsService.update).not.toHaveBeenCalled();
    });

    it('patient: ignora healthPlanId, photoPath e ownerId', async () => {
      await setUpdateSc('patient', {
        name: 'Maria',
        healthPlanId: 'hp-outra-clinica',
        photoPath: 'outro/arquivo.png',
        ownerId: 'x',
      });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('ok');
      const [, dto] = mockPatientsService.update.mock.calls[0];
      expect({ ...dto }).toEqual({ name: 'Maria' });
      expect(commit?.data.ignoredFields).toEqual([
        'healthPlanId',
        'photoPath',
        'ownerId',
      ]);
    });

    it('patient: dado inválido não chega ao service', async () => {
      await setUpdateSc('patient', { birthDate: 'ontem' });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('error');
      expect(commit?.message).toContain('birthDate inválido');
      expect(mockPatientsService.update).not.toHaveBeenCalled();
    });

    it('scope desconhecido devolve erro', async () => {
      await setUpdateSc('owner', { ownerId: 'x' });

      const commit = await commitUpdateSc();

      expect(commit?.status).toBe('error');
      expect(mockSurgeryRequestsService.update).not.toHaveBeenCalled();
      expect(mockPatientsService.update).not.toHaveBeenCalled();
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
        expect.objectContaining({ phone: '11912345678' }),
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

  describe('IDOR — commit revalida o acesso à SC do draft', () => {
    const casos: Array<[string, string, Record<string, unknown>, string[]]> = [
      [
        'scheduling_draft_commit',
        'scheduling',
        { dateOptions: ['2026-02-01'], confirmedDateIndex: 0 },
        ['updateDateOptions', 'confirmDate'],
      ],
      [
        'invoice_draft_commit',
        'invoice',
        {
          invoiceProtocol: 'FAT-1',
          invoiceValue: 10,
          invoiceSentAt: '2026-01-10',
        },
        ['invoiceRequest'],
      ],
      [
        'contestation_draft_commit',
        'contestation',
        {
          contestationType: 'AUTHORIZATION',
          reason: 'motivo',
          method: 'document',
        },
        ['contestAuthorization', 'contestPayment'],
      ],
      [
        'update_sc_draft_commit',
        'update_sc',
        { scope: 'admin', changes: { priority: 'HIGH' } },
        [],
      ],
    ];

    it.each(casos)(
      '%s recusa SC de médico fora do vínculo do usuário',
      async (toolName, draftType, campos, metodos) => {
        await draftService.start({
          conversationId: 'conv-1',
          type: draftType as any,
        });
        await draftService.setFields('conv-1', draftType as any, {
          surgeryRequestId: 'sc-vitima',
          surgeryRequestLabel: 'SC-9999',
          ...campos,
        });
        mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
          id: 'sc-vitima',
          protocol: 'SC-9999',
          doctorId: 'medico-de-outra-clinica',
          patientId: 'pat-x',
          status: 4,
        });

        const result = parseToolResult<any>(
          await getTool(toolName).execute({ confirm: true }, context),
        );

        expect(result?.status).toBe('error');
        expect(result?.message).toMatch(/permissão/i);
        for (const metodo of metodos) {
          expect(mockWorkflowService[metodo]).not.toHaveBeenCalled();
        }
        expect(mockSurgeryRequestsService.update).not.toHaveBeenCalled();
        expect(mockPatientsService.update).not.toHaveBeenCalled();
        expect(mockActivityRepo.create).not.toHaveBeenCalled();
      },
    );
  });
});
