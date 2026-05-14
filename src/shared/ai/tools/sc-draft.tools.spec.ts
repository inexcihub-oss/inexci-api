import { buildScDraftTools } from './sc-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('sc-draft tools (preview + commit)', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let mockUserRepo: any;
  let mockSurgeryRequestRepo: any;
  let mockSurgeryRequestsService: any;
  let mockActivityRepo: any;
  let tools: ReturnType<typeof buildScDraftTools>;

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
    mockUserRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'doctor-1', name: 'Dra. Maria Andrade' }),
    };
    mockSurgeryRequestRepo = {
      findOneSimple: jest.fn().mockResolvedValue({
        id: 'sc-new',
        protocol: '0042',
      }),
    };
    mockSurgeryRequestsService = {
      createSurgeryRequest: jest.fn().mockResolvedValue({
        id: 'sc-new',
        protocol: '0042',
      }),
    };
    mockActivityRepo = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    tools = buildScDraftTools({
      draftService,
      userRepo: mockUserRepo,
      surgeryRequestRepo: mockSurgeryRequestRepo,
      surgeryRequestsService: mockSurgeryRequestsService,
      activityRepo: mockActivityRepo,
    });
  });

  it('expõe apenas preview e commit (setters/status/cancel migrados para draft_update/draft_status/draft_cancel)', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'sc_draft_preview',
      'sc_draft_commit',
    ]);
  });

  it('sc_draft_preview falha quando faltam campos obrigatórios', async () => {
    const raw = await getTool('sc_draft_preview').execute({}, context);
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('blocked');
  });

  it('sc_draft_preview com draft completo retorna pending_confirmation', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      patientLabel: 'Beatriz Helena Santos',
      procedureId: 'pro-1',
      procedureLabel: 'Artroplastia total do joelho',
      hospitalId: 'h-1',
      hospitalLabel: 'Hospital Israelita Albert Einstein',
      healthPlanId: 'hp-1',
      healthPlanLabel: 'Unimed Paulistana',
      priority: 'MEDIUM',
    });

    const raw = await getTool('sc_draft_preview').execute({}, context);
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('pending_confirmation');
    expect(parsed?.display_text).toContain('Beatriz Helena Santos');
    expect(parsed?.display_text).toContain('Artroplastia');
    expect(parsed?.pending_confirmation?.tool).toBe('sc_draft_commit');
  });

  it('sc_draft_commit sem confirm devolve pending_confirmation e não cria SC', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      patientLabel: 'Beatriz',
      procedureId: 'pro-1',
      procedureLabel: 'Artroplastia',
      hospitalId: 'h-1',
      healthPlanId: 'hp-1',
      priority: 'MEDIUM',
    });

    const raw = await getTool('sc_draft_commit').execute({}, context);
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('pending_confirmation');
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).not.toHaveBeenCalled();
  });

  it('sc_draft_commit com confirm=true cria a SC e finaliza o draft', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      patientLabel: 'Beatriz Helena',
      procedureId: 'pro-1',
      procedureLabel: 'Artroplastia',
      hospitalId: 'h-1',
      hospitalLabel: 'Albert Einstein',
      healthPlanId: 'hp-1',
      healthPlanLabel: 'Unimed',
      priority: 'MEDIUM',
    });

    const raw = await getTool('sc_draft_commit').execute(
      { confirm: true },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('ok');
    expect(parsed?.data.id).toBe('sc-new');
    expect(parsed?.data.protocol).toBe('SC-0042');
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        procedureId: 'pro-1',
        priority: 2,
        hospitalId: 'h-1',
        healthPlanId: 'hp-1',
      }),
      'user-1',
    );
    expect(mockActivityRepo.create).toHaveBeenCalled();
    expect(conv.operationDraft).toBeNull();
  });

  it('sc_draft_commit auto-preenche doctorId quando o usuário tem só 1 médico acessível', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      procedureId: 'pro-1',
      priority: 'MEDIUM',
    });

    await getTool('sc_draft_commit').execute({ confirm: true }, context);

    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: 'doctor-1' }),
      'user-1',
    );
  });

  it('sc_draft_commit bloqueia quando o usuário tem múltiplos médicos acessíveis e doctorId não foi preenchido', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      procedureId: 'pro-1',
      priority: 'MEDIUM',
    });

    const raw = await getTool('sc_draft_commit').execute(
      { confirm: true },
      { ...context, accessibleDoctorIds: ['doctor-1', 'doctor-2'] },
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('blocked');
    expect(parsed?.next_required_fields).toContain('doctorId');
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).not.toHaveBeenCalled();
  });
});
