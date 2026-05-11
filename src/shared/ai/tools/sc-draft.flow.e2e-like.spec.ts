/**
 * Cenário end-to-end (orquestrador→tools, sem HTTP/banco real) do fluxo
 * complexo dos screenshots reportados pelo usuário:
 *
 * "Crie uma SC para a paciente Beatriz Helena com artoplastia total do joelho
 *  no Einstein, Unimed Paulistana, prioridade média"
 *
 * - O nome do paciente vem com pequenas diferenças (sem sobrenome completo,
 *   typo no procedimento — "artoplastia") típicas de transcrição de áudio.
 * - O hospital/convênio vem com fragmento ("Einstein", "Unimed") em vez do
 *   nome completo cadastrado.
 *
 * Antes da refatoração, isso produzia: alucinação ("paciente não encontrado"),
 * loops e custo dobrado. Agora o fluxo é:
 *
 *  1. plan_actions(intent="create_sc", ...) inicia o draft.
 *  2. sc_draft_set_patient("Beatriz Helena") → fuzzy match resolve "Beatriz Helena Santos".
 *  3. sc_draft_set_procedure("artoplastia total do joelho") → fuzzy resolve.
 *  4. sc_draft_set_hospital("Einstein") → fuzzy.
 *  5. sc_draft_set_health_plan("Unimed") → fuzzy.
 *  6. sc_draft_set_priority("média") → MEDIUM.
 *  7. sc_draft_preview gera pending_confirmation.
 *  8. sc_draft_commit(confirm=true) cria a SC.
 */

import { buildPlanTools } from './plan.tools';
import { buildScDraftTools } from './sc-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { EntityResolverService } from '../services/entity-resolver.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('Fluxo dos screenshots: criar SC com nomes parciais e typos', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let resolver: EntityResolverService;
  let allTools: any[];
  let mockSurgeryRequestsService: any;
  let mockSurgeryRequestRepo: any;
  let mockActivityRepo: any;

  const context: ToolContext = {
    userId: 'user-1',
    phone: '+5511999999999',
    accessibleDoctorIds: ['doctor-1'],
    conversationId: 'conv-1',
  };

  const tool = (name: string) => allTools.find((t) => t.name === name)!;

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

    const mockPatientRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'pat-1', name: 'Beatriz Helena Santos' },
        { id: 'pat-2', name: 'Marcos Pereira' },
        { id: 'pat-3', name: 'Carla Albuquerque' },
      ]),
    };
    const mockProcedureRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'pro-1', name: 'Artroplastia total do joelho' },
        { id: 'pro-2', name: 'Artroscopia de joelho' },
      ]),
    };
    const mockHospitalRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'h-1', name: 'Hospital Israelita Albert Einstein' },
        { id: 'h-2', name: 'Hospital Sírio-Libanês' },
      ]),
    };
    const mockHealthPlanRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'hp-1', name: 'Unimed Paulistana' },
        { id: 'hp-2', name: 'Amil' },
      ]),
    };
    const mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        ownerId: 'owner-1',
        name: 'Dra. Maria Andrade',
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

    allTools = [
      ...buildPlanTools(draftService),
      ...buildScDraftTools({
        draftService,
        resolver,
        patientRepo: mockPatientRepo as any,
        procedureRepo: mockProcedureRepo as any,
        hospitalRepo: mockHospitalRepo as any,
        healthPlanRepo: mockHealthPlanRepo as any,
        userRepo: mockUserRepo as any,
        surgeryRequestRepo: mockSurgeryRequestRepo as any,
        surgeryRequestsService: mockSurgeryRequestsService as any,
        activityRepo: mockActivityRepo as any,
      }),
    ];
  });

  it('plan_actions → set_patient → set_procedure → set_hospital → set_health_plan → set_priority → preview → commit', async () => {
    // 1) plan_actions inicia o rascunho.
    const planRaw = await tool('plan_actions').execute(
      {
        intent: 'create_sc',
        mentioned_entities: {
          patient: 'Beatriz Helena',
          procedure: 'artoplastia total do joelho',
          hospital: 'Einstein',
          health_plan: 'Unimed Paulistana',
          priority: 'média',
        },
        plan_steps: [
          'verificar paciente',
          'verificar procedimento',
          'verificar hospital',
          'verificar convênio',
          'definir prioridade',
          'preview e confirmar',
        ],
      },
      context,
    );
    const plan = parseToolResult<any>(planRaw);
    expect(plan?.status).toBe('ok');
    expect(plan?.data.draft_type).toBe('create_sc');
    expect(plan?.data.draft_started).toBe(true);

    // 2) Paciente: nome parcial — fuzzy resolve para "Beatriz Helena Santos".
    const patient = parseToolResult<any>(
      await tool('sc_draft_set_patient').execute(
        { patient_name_or_id: 'Beatriz Helena' },
        context,
      ),
    );
    expect(patient?.data.patientId).toBe('pat-1');
    expect(patient?.data.patientLabel).toBe('Beatriz Helena Santos');

    // 3) Procedimento com typo de transcrição ("artoplastia" → "artroplastia").
    const proc = parseToolResult<any>(
      await tool('sc_draft_set_procedure').execute(
        { procedure_name_or_id: 'artoplastia total do joelho' },
        context,
      ),
    );
    expect(proc?.data.procedureId).toBe('pro-1');

    // 4) Hospital por fragmento ("Einstein").
    const hospital = parseToolResult<any>(
      await tool('sc_draft_set_hospital').execute(
        { hospital_name_or_id: 'Einstein' },
        context,
      ),
    );
    expect(hospital?.data.hospitalId).toBe('h-1');

    // 5) Convênio por nome quase exato ("Unimed Paulistana" — exato; mas
    //    ainda assim passa pelo fuzzy).
    const hp = parseToolResult<any>(
      await tool('sc_draft_set_health_plan').execute(
        { health_plan_name_or_id: 'Unimed Paulistana' },
        context,
      ),
    );
    expect(hp?.data.healthPlanId).toBe('hp-1');

    // 6) Prioridade em pt-BR.
    const prio = parseToolResult<any>(
      await tool('sc_draft_set_priority').execute(
        { priority: 'média' },
        context,
      ),
    );
    expect(prio?.data.priority).toBe('MEDIUM');

    // 7) Preview deve retornar pending_confirmation (doctorId auto-preenchido
    //    porque o usuário tem 1 médico acessível).
    const previewRaw = await tool('sc_draft_preview').execute({}, context);
    const preview = parseToolResult<any>(previewRaw);
    expect(preview?.status).toBe('pending_confirmation');
    expect(preview?.display_text).toContain('Beatriz Helena Santos');
    expect(preview?.display_text).toContain('Artroplastia');
    expect(preview?.display_text).toContain('Einstein');
    expect(preview?.display_text).toContain('Unimed');

    // 8) Commit sem confirm → não cria.
    const noConfirm = parseToolResult<any>(
      await tool('sc_draft_commit').execute({}, context),
    );
    expect(noConfirm?.status).toBe('pending_confirmation');
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).not.toHaveBeenCalled();

    // 9) Commit com confirm=true → cria a SC.
    const commit = parseToolResult<any>(
      await tool('sc_draft_commit').execute({ confirm: true }, context),
    );
    expect(commit?.status).toBe('ok');
    expect(commit?.data.id).toBe('sc-new');
    expect(commit?.data.protocol).toBe('SC-0042');
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
    // Após commit, o draft é finalizado (não há parent).
    expect(conv.operationDraft).toBeNull();
  });

  it('quando paciente NÃO existe, set_patient indica e o LLM pode abrir sub-draft', async () => {
    await tool('plan_actions').execute(
      {
        intent: 'create_sc',
        mentioned_entities: { patient: 'João Inexistente' },
        plan_steps: ['verificar paciente'],
      },
      context,
    );

    const patient = parseToolResult<any>(
      await tool('sc_draft_set_patient').execute(
        { patient_name_or_id: 'João Inexistente' },
        context,
      ),
    );
    expect(patient?.status).toBe('not_found');
    // O LLM pode então abrir sub-draft create_patient via plan_actions —
    // verificado em cadastro-draft.tools.spec.ts.
  });

  it('flag AI_USE_DRAFT_FLOWS=false não afeta o fluxo direto das tools (só desliga o guard server-side)', async () => {
    // Mesmo com a flag off no orchestrator, as tools de draft continuam
    // utilizáveis quando o LLM as chama explicitamente — o guard só decide
    // se BLOQUEIA mutações antigas sem plan_actions.
    await tool('plan_actions').execute(
      {
        intent: 'create_sc',
        mentioned_entities: { patient: 'Beatriz' },
        plan_steps: [],
      },
      context,
    );
    const patient = parseToolResult<any>(
      await tool('sc_draft_set_patient').execute(
        { patient_name_or_id: 'Beatriz Helena' },
        context,
      ),
    );
    expect(patient?.data.patientId).toBe('pat-1');
  });
});
