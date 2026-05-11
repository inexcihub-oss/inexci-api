import { buildScDraftTools } from './sc-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { EntityResolverService } from '../services/entity-resolver.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('sc-draft tools', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let resolver: EntityResolverService;
  let mockPatientRepo: any;
  let mockProcedureRepo: any;
  let mockHospitalRepo: any;
  let mockHealthPlanRepo: any;
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
    resolver = new EntityResolverService();
    mockPatientRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'pat-1', name: 'Beatriz Helena Santos' },
        { id: 'pat-2', name: 'Marcos Pereira' },
      ]),
    };
    mockProcedureRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'pro-1', name: 'Artroplastia total do joelho' },
        { id: 'pro-2', name: 'Apendicectomia' },
      ]),
    };
    mockHospitalRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'h-1', name: 'Hospital Israelita Albert Einstein' },
        { id: 'h-2', name: 'Hospital Sírio-Libanês' },
      ]),
    };
    mockHealthPlanRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'hp-1', name: 'Unimed Paulistana' },
        { id: 'hp-2', name: 'Amil' },
      ]),
    };
    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        ownerId: 'owner-1',
      }),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'doctor-1', name: 'Dra. Maria Andrade', ownerId: 'owner-1' },
        ]),
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
      resolver,
      patientRepo: mockPatientRepo,
      procedureRepo: mockProcedureRepo,
      hospitalRepo: mockHospitalRepo,
      healthPlanRepo: mockHealthPlanRepo,
      userRepo: mockUserRepo,
      surgeryRequestRepo: mockSurgeryRequestRepo,
      surgeryRequestsService: mockSurgeryRequestsService,
      activityRepo: mockActivityRepo,
    });
  });

  it('sc_draft_set_patient resolve nome com fuzzy match e grava no draft', async () => {
    const raw = await getTool('sc_draft_set_patient').execute(
      { patient_name_or_id: 'Beatriz Helena' },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('needs_input'); // ainda faltam outros campos
    expect(parsed?.data.patientId).toBe('pat-1');
    expect(parsed?.data.patientLabel).toBe('Beatriz Helena Santos');
    expect(conv.operationDraft.fields.patientId).toBe('pat-1');
  });

  it('sc_draft_set_procedure tolera typo (artoplastia → artroplastia)', async () => {
    const raw = await getTool('sc_draft_set_procedure').execute(
      { procedure_name_or_id: 'artoplastia total do joelho' },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.data.procedureId).toBe('pro-1');
  });

  it('sc_draft_set_hospital com nome parcial casa "Albert Einstein" → "Hospital Israelita Albert Einstein"', async () => {
    const raw = await getTool('sc_draft_set_hospital').execute(
      { hospital_name_or_id: 'Albert Einstein' },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('ok');
    expect(parsed?.data.hospitalId).toBe('h-1');
  });

  it('sc_draft_set_hospital aceita null para criar sem hospital', async () => {
    const raw = await getTool('sc_draft_set_hospital').execute(
      { hospital_name_or_id: null },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('ok');
    expect(conv.operationDraft.fields.hospitalId).toBeNull();
  });

  it('sc_draft_set_priority aceita "média" e converte para MEDIUM', async () => {
    const raw = await getTool('sc_draft_set_priority').execute(
      { priority: 'média' },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.data.priority).toBe('MEDIUM');
    expect(conv.operationDraft.fields.priority).toBe('MEDIUM');
  });

  it('sc_draft_set_patient retorna ambíguo com candidatos quando vários nomes parecidos', async () => {
    mockPatientRepo.findMany.mockResolvedValue([
      { id: 'pat-a', name: 'Maria Silva' },
      { id: 'pat-b', name: 'Maria Souza' },
      { id: 'pat-c', name: 'Maria Santos' },
    ]);
    const raw = await getTool('sc_draft_set_patient').execute(
      { patient_name_or_id: 'Maria' },
      context,
    );
    const parsed = JSON.parse(raw);
    expect(parsed.status).toBe('ambiguous');
    expect(parsed.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('sc_draft_preview falha quando faltam campos obrigatórios', async () => {
    const raw = await getTool('sc_draft_preview').execute({}, context);
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('blocked');
  });

  it('fluxo completo: set_patient + set_procedure + set_priority + preview + commit cria SC', async () => {
    // 1. Plan_actions seria chamado primeiro, mas vamos abrir o draft manualmente.
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });

    // 2. Set fields em qualquer ordem.
    await getTool('sc_draft_set_patient').execute(
      { patient_name_or_id: 'Beatriz Helena' },
      context,
    );
    await getTool('sc_draft_set_procedure').execute(
      { procedure_name_or_id: 'artroplastia' },
      context,
    );
    await getTool('sc_draft_set_hospital').execute(
      { hospital_name_or_id: 'Einstein' },
      context,
    );
    await getTool('sc_draft_set_health_plan').execute(
      { health_plan_name_or_id: 'Unimed' },
      context,
    );
    await getTool('sc_draft_set_priority').execute(
      { priority: 'média' },
      context,
    );

    // 3. Preview.
    const previewRaw = await getTool('sc_draft_preview').execute({}, context);
    const previewParsed = parseToolResult<any>(previewRaw);
    expect(previewParsed?.status).toBe('pending_confirmation');
    expect(previewParsed?.display_text).toContain('Beatriz Helena Santos');
    expect(previewParsed?.display_text).toContain('Artroplastia');

    // 4. Commit sem confirm=true devolve pending_confirmation.
    const commitNoConfirm = await getTool('sc_draft_commit').execute(
      {},
      context,
    );
    expect(parseToolResult<any>(commitNoConfirm)?.status).toBe(
      'pending_confirmation',
    );
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).not.toHaveBeenCalled();

    // 5. Commit com confirm=true cria a SC.
    const commitRaw = await getTool('sc_draft_commit').execute(
      { confirm: true },
      context,
    );
    const commitParsed = parseToolResult<any>(commitRaw);
    expect(commitParsed?.status).toBe('ok');
    expect(commitParsed?.data.id).toBe('sc-new');
    expect(commitParsed?.data.protocol).toBe('SC-0042');
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        procedureId: 'pro-1',
        priority: 2, // MEDIUM
        hospitalId: 'h-1',
        healthPlanId: 'hp-1',
      }),
      'user-1',
    );
    expect(mockActivityRepo.create).toHaveBeenCalled();
    // Draft deve ter sido finalizado.
    expect(conv.operationDraft).toBeNull();
  });

  it('sc_draft_cancel limpa o draft', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await getTool('sc_draft_cancel').execute({}, context);
    expect(conv.operationDraft).toBeNull();
  });

  it('sc_draft_status lista campos pendentes', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    const raw = await getTool('sc_draft_status').execute({}, context);
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('needs_input');
    expect(parsed?.next_required_fields).toEqual(
      expect.arrayContaining([
        'patientId',
        'doctorId',
        'procedureId',
        'priority',
      ]),
    );
  });
});
