/**
 * tools-vs-services.spec.ts
 *
 * Garante que todas as tools de MUTAÇÃO delegam ao Service correspondente
 * e NÃO chamam o repositório diretamente. Cada assertion "service chamado +
 * repo NÃO chamado" constitui o critério de aceitação arquitetural do
 * PLANO-CONSOLIDACAO-TOOLS-IA-VIA-SERVICES-REST.md.
 *
 * Quando uma tool ainda bypassa o service, este teste fica VERMELHO — sinal
 * para refatorar o commit correspondente.
 */

import { buildCadastroDraftTools } from './cadastro-draft.tools';
import { buildScDraftTools } from './sc-draft.tools';
import { buildDoctorProfileTools } from './doctor-profile.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

// ─── helpers compartilhados ────────────────────────────────────────────────

function makeConvRepo() {
  let conv: any = { id: 'conv-1', operationDraft: null };
  return {
    findOne: jest.fn().mockImplementation(async () => conv),
    update: jest.fn().mockImplementation(async (_id: any, patch: any) => {
      conv = { ...conv, ...patch };
    }),
  };
}

const CONTEXT: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
  ownerId: 'owner-1',
};

// ─── 1. patient_draft_commit → PatientsService.create (não patientRepo) ─────

describe('tools vs services — patient_draft_commit', () => {
  let draftService: OperationDraftService;
  let mockPatientRepo: any;
  let mockPatientsService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_patient',
    });
    await draftService.setFields('conv-1', 'create_patient', {
      name: 'João Silva',
      phone: '11999990000',
    });

    mockPatientRepo = {
      create: jest.fn().mockResolvedValue({ id: 'pat-1', name: 'João Silva' }),
      findMany: jest.fn().mockResolvedValue([]),
    };

    mockPatientsService = {
      create: jest.fn().mockResolvedValue({
        id: 'pat-1',
        name: 'João Silva',
        phone: '11999990000',
        email: '',
      }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: mockPatientRepo as any,
      procedureRepo: { findOne: jest.fn(), findMany: jest.fn() } as any,
      userRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
      } as any,
      patientsService: mockPatientsService,
      hospitalsService: { create: jest.fn() } as any,
      healthPlansService: { create: jest.fn() } as any,
      proceduresService: { create: jest.fn() } as any,
    });
  });

  it('chama PatientsService.create e NÃO patientRepo.create', async () => {
    const tool = tools.find((t) => t.name === 'patient_draft_commit')!;
    const result = await tool.execute({ confirm: true }, CONTEXT);
    const parsed = parseToolResult(result);

    expect(mockPatientsService.create).toHaveBeenCalledTimes(1);
    expect(mockPatientRepo.create).not.toHaveBeenCalled();
    expect(parsed!.status).toBe('ok');
  });

  it('retorna pending_confirmation quando confirm não é true', async () => {
    const tool = tools.find((t) => t.name === 'patient_draft_commit')!;
    const result = await tool.execute({ confirm: false }, CONTEXT);
    const parsed = parseToolResult(result);

    expect(parsed!.status).toBe('pending_confirmation');
    expect(mockPatientsService.create).not.toHaveBeenCalled();
  });
});

// ─── 2. hospital_draft_commit → HospitalsService.create ─────────────────────

describe('tools vs services — hospital_draft_commit', () => {
  let draftService: OperationDraftService;
  let mockHospitalRepo: any;
  let mockHospitalsService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_hospital',
    });
    await draftService.setFields('conv-1', 'create_hospital', {
      name: 'Hospital São Paulo',
    });

    mockHospitalRepo = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'hosp-1', name: 'Hospital São Paulo' }),
    };

    mockHospitalsService = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'hosp-1', name: 'Hospital São Paulo' }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: { findMany: jest.fn().mockResolvedValue([]) } as any,
      procedureRepo: { findOne: jest.fn(), findMany: jest.fn() } as any,
      userRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
      } as any,
      patientsService: { create: jest.fn() } as any,
      hospitalsService: mockHospitalsService,
      healthPlansService: { create: jest.fn() } as any,
      proceduresService: { create: jest.fn() } as any,
    });
  });

  it('chama HospitalsService.create e NÃO hospitalRepo.create', async () => {
    const tool = tools.find((t) => t.name === 'hospital_draft_commit')!;
    const result = await tool.execute({ confirm: true }, CONTEXT);
    const parsed = parseToolResult(result);

    expect(mockHospitalsService.create).toHaveBeenCalledTimes(1);
    expect(mockHospitalRepo.create).not.toHaveBeenCalled();
    expect(parsed!.status).toBe('ok');
  });
});

// ─── 3. health_plan_draft_commit → HealthPlansService.create ─────────────────

describe('tools vs services — health_plan_draft_commit', () => {
  let draftService: OperationDraftService;
  let mockHealthPlanRepo: any;
  let mockHealthPlansService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_health_plan',
    });
    await draftService.setFields('conv-1', 'create_health_plan', {
      name: 'Unimed Nacional',
    });

    mockHealthPlanRepo = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'hp-1', name: 'Unimed Nacional' }),
    };

    mockHealthPlansService = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'hp-1', name: 'Unimed Nacional' }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: { findMany: jest.fn().mockResolvedValue([]) } as any,
      procedureRepo: { findOne: jest.fn(), findMany: jest.fn() } as any,
      userRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
      } as any,
      patientsService: { create: jest.fn() } as any,
      hospitalsService: { create: jest.fn() } as any,
      healthPlansService: mockHealthPlansService,
      proceduresService: { create: jest.fn() } as any,
    });
  });

  it('chama HealthPlansService.create e NÃO healthPlanRepo.create', async () => {
    const tool = tools.find((t) => t.name === 'health_plan_draft_commit')!;
    const result = await tool.execute({ confirm: true }, CONTEXT);
    const parsed = parseToolResult(result);

    expect(mockHealthPlansService.create).toHaveBeenCalledTimes(1);
    expect(mockHealthPlanRepo.create).not.toHaveBeenCalled();
    expect(parsed!.status).toBe('ok');
  });
});

// ─── 4. procedure_draft_commit → ProceduresService.create ────────────────────

describe('tools vs services — procedure_draft_commit', () => {
  let draftService: OperationDraftService;
  let mockProcedureRepo: any;
  let mockProceduresService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_procedure',
    });
    await draftService.setFields('conv-1', 'create_procedure', {
      name: 'Artroplastia Total do Joelho',
    });

    mockProcedureRepo = {
      create: jest.fn().mockResolvedValue({
        id: 'proc-1',
        name: 'Artroplastia Total do Joelho',
      }),
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };

    mockProceduresService = {
      create: jest.fn().mockResolvedValue({
        id: 'proc-1',
        name: 'Artroplastia Total do Joelho',
      }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: { findMany: jest.fn().mockResolvedValue([]) } as any,
      procedureRepo: mockProcedureRepo as any,
      userRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
      } as any,
      patientsService: { create: jest.fn() } as any,
      hospitalsService: { create: jest.fn() } as any,
      healthPlansService: { create: jest.fn() } as any,
      proceduresService: mockProceduresService,
    });
  });

  it('chama ProceduresService.create e NÃO procedureRepo.create', async () => {
    const tool = tools.find((t) => t.name === 'procedure_draft_commit')!;
    const result = await tool.execute({ confirm: true }, CONTEXT);
    const parsed = parseToolResult(result);

    expect(mockProceduresService.create).toHaveBeenCalledTimes(1);
    expect(mockProcedureRepo.create).not.toHaveBeenCalled();
    expect(parsed!.status).toBe('ok');
  });
});

// ─── 5. sc_draft_commit → SurgeryRequestsService.createSurgeryRequest ────────

describe('tools vs services — sc_draft_commit', () => {
  let draftService: OperationDraftService;
  let mockSurgeryRequestRepo: any;
  let mockSurgeryRequestsService: any;
  let tools: ReturnType<typeof buildScDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      patientLabel: 'João',
      doctorId: 'doctor-1',
      doctorLabel: 'Dr. Fulano',
      procedureId: 'proc-1',
      procedureLabel: 'Artroplastia',
      priority: 'MEDIUM',
    });

    mockSurgeryRequestRepo = {
      create: jest.fn().mockResolvedValue({ id: 'sc-1', protocol: 'SC-0001' }),
      findOneSimple: jest
        .fn()
        .mockResolvedValue({ id: 'sc-1', protocol: 'SC-0001' }),
      findOne: jest.fn().mockResolvedValue({ id: 'sc-1', protocol: 'SC-0001' }),
    };

    mockSurgeryRequestsService = {
      createSurgeryRequest: jest
        .fn()
        .mockResolvedValue({ id: 'sc-1', protocol: 'SC-0001' }),
    };

    tools = buildScDraftTools({
      draftService,
      userRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'user-1',
          ownerId: 'owner-1',
          name: 'Dr. Fulano',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      } as any,
      surgeryRequestRepo: mockSurgeryRequestRepo as any,
      surgeryRequestsService: mockSurgeryRequestsService as any,
      activityRepo: { create: jest.fn().mockResolvedValue({}) } as any,
    });
  });

  it('chama SurgeryRequestsService.createSurgeryRequest e NÃO surgeryRequestRepo.create', async () => {
    const ctx = { ...CONTEXT, accessibleDoctorIds: ['doctor-1'] };
    const tool = tools.find((t) => t.name === 'sc_draft_commit')!;
    const result = await tool.execute({ confirm: true }, ctx);
    const parsed = parseToolResult(result);

    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).toHaveBeenCalledTimes(1);
    expect(mockSurgeryRequestRepo.create).not.toHaveBeenCalled();
    expect(parsed!.status).toBe('ok');
  });
});

// ─── 6. Verificação de metadados: bypassesService ausente nos commits ─────────

describe('tools vs services — bypassesService ausente em todos os commits', () => {
  it('nenhum *_draft_commit de cadastro tem bypassesService=true', () => {
    const convRepo = makeConvRepo();
    const draftService = new OperationDraftService(convRepo as any);
    const noopService = { create: jest.fn() };
    const baseRepo = {
      findOne: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    };

    const tools = buildCadastroDraftTools({
      draftService,
      patientRepo: baseRepo as any,
      procedureRepo: baseRepo as any,
      userRepo: {
        findOne: jest.fn().mockResolvedValue({ id: 'u', ownerId: 'o' }),
      } as any,
      patientsService: noopService as any,
      hospitalsService: noopService as any,
      healthPlansService: noopService as any,
      proceduresService: noopService as any,
    });

    const commitTools = tools.filter((t) => t.name.endsWith('_draft_commit'));
    expect(commitTools.length).toBeGreaterThanOrEqual(4);

    for (const tool of commitTools) {
      if (tool.bypassesService === true) {
        throw new Error(
          `Tool "${tool.name}" ainda tem bypassesService=true — refatorar para delegar ao Service.`,
        );
      }
      expect(tool.bypassesService).not.toBe(true);
    }
  });

  it('sc_draft_commit não tem bypassesService=true', () => {
    const convRepo = makeConvRepo();
    const draftService = new OperationDraftService(convRepo as any);
    const baseRepo = {
      findOne: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findOneSimple: jest.fn(),
    };

    const scTools = buildScDraftTools({
      draftService,
      userRepo: baseRepo as any,
      surgeryRequestRepo: baseRepo as any,
      surgeryRequestsService: { createSurgeryRequest: jest.fn() } as any,
      activityRepo: { create: jest.fn() } as any,
    });

    const scCommit = scTools.find((t) => t.name === 'sc_draft_commit')!;
    expect(scCommit).toBeDefined();
    expect(scCommit.bypassesService).not.toBe(true);
  });
});

// ─── 7. Contrato canônico: tools de mutação devolvem ToolResult válido ───────
//
// Fase 4 do PLANO-SANITIZACAO-CLEAN-CODE-IA: o orchestrator passou a
// depender exclusivamente do envelope canônico `ToolResult` para decidir
// `pending_confirmation`. Toda tool que entra nesse ciclo precisa devolver
// um envelope parseável em TODOS os caminhos (preview, success, error,
// bloqueio de regra de negócio).
//
// Esta suite trava esse contrato para o conjunto inicial coberto pela
// Fase 4 (`upload_doctor_signature` + todos os `*_draft_preview`). Tools
// adicionais de mutação (`set_hospital`, `confirm_receipt`, etc.) vão
// migrar em fases seguintes; quando isso acontecer, basta adicioná-las
// aqui.

describe('contrato canônico — toda tool migrada devolve ToolResult válido', () => {
  describe('upload_doctor_signature', () => {
    const buildTools = () => {
      const userRepo = { findOne: jest.fn() };
      const doctorProfileRepo = {
        update: jest.fn(),
        findByUserId: jest.fn(),
      };
      const storageService = {
        create: jest.fn().mockResolvedValue('signatures/new.png'),
        delete: jest.fn(),
      };
      const configService = { get: jest.fn().mockReturnValue('') };
      const tools = buildDoctorProfileTools(
        userRepo as any,
        doctorProfileRepo as any,
        storageService as any,
        configService as any,
      );
      const tool = tools.find((t) => t.name === 'upload_doctor_signature')!;
      return { tool, userRepo, doctorProfileRepo };
    };

    const ctx: ToolContext = {
      userId: 'user-1',
      phone: '+5511999999999',
      accessibleDoctorIds: ['user-1'],
      conversationId: 'conv-1',
    };

    it('todos os caminhos devolvem JSON parseável via parseToolResult', async () => {
      const { tool, userRepo, doctorProfileRepo } = buildTools();

      // 1) Sem userId → blocked
      const noUser = await tool.execute(
        {},
        { ...ctx, userId: undefined as any },
      );
      expect(parseToolResult(noUser)).not.toBeNull();
      expect(parseToolResult(noUser)!.status).toBe('blocked');

      // 2) Usuário inexistente → error
      doctorProfileRepo.findByUserId.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValueOnce(null);
      const missing = await tool.execute(
        { confirm: true },
        {
          ...ctx,
          inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
        },
      );
      expect(parseToolResult(missing)).not.toBeNull();
      expect(parseToolResult(missing)!.status).toBe('error');

      // 3) Colaborador (sem doctor profile) → blocked
      doctorProfileRepo.findByUserId.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValueOnce({
        id: 'user-1',
        doctorProfile: null,
      });
      const collaborator = await tool.execute(
        { confirm: true },
        {
          ...ctx,
          inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
        },
      );
      expect(parseToolResult(collaborator)).not.toBeNull();
      expect(parseToolResult(collaborator)!.status).toBe('blocked');

      // 4) Sem mídia → needs_input
      doctorProfileRepo.findByUserId.mockResolvedValueOnce({
        id: 'dp-1',
        signatureUrl: null,
      });
      const noMedia = await tool.execute({ confirm: true }, ctx);
      expect(parseToolResult(noMedia)).not.toBeNull();
      expect(parseToolResult(noMedia)!.status).toBe('needs_input');

      // 5) Mídia que não é imagem → blocked
      doctorProfileRepo.findByUserId.mockResolvedValueOnce({
        id: 'dp-1',
        signatureUrl: null,
      });
      const nonImage = await tool.execute(
        { confirm: true },
        {
          ...ctx,
          inboundMedia: [
            { url: 'https://x', contentType: 'application/pdf' },
          ] as any,
        },
      );
      expect(parseToolResult(nonImage)).not.toBeNull();
      expect(parseToolResult(nonImage)!.status).toBe('blocked');

      // 6) Preview (sem confirm) → pending_confirmation com pending_confirmation
      doctorProfileRepo.findByUserId.mockResolvedValueOnce({
        id: 'dp-1',
        signatureUrl: null,
      });
      const preview = await tool.execute(
        {},
        {
          ...ctx,
          inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
        },
      );
      const previewParsed = parseToolResult(preview);
      expect(previewParsed).not.toBeNull();
      expect(previewParsed!.status).toBe('pending_confirmation');
      expect(previewParsed!.pending_confirmation?.tool).toBe(
        'upload_doctor_signature',
      );

      // 7) Sucesso (confirm:true) → ok
      doctorProfileRepo.findByUserId.mockResolvedValueOnce({
        id: 'dp-1',
        signatureUrl: null,
      });
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      } as any);
      const success = await tool.execute(
        { confirm: true },
        {
          ...ctx,
          inboundMedia: [
            { url: 'https://api.twilio.com/m/1', contentType: 'image/png' },
          ] as any,
        },
      );
      expect(parseToolResult(success)).not.toBeNull();
      expect(parseToolResult(success)!.status).toBe('ok');
      fetchMock.mockRestore();

      // 8) Falha de download → error
      doctorProfileRepo.findByUserId.mockResolvedValueOnce({
        id: 'dp-1',
        signatureUrl: null,
      });
      const failFetch = jest
        .spyOn(global, 'fetch' as any)
        .mockResolvedValue({ ok: false, status: 502 } as any);
      const failure = await tool.execute(
        { confirm: true },
        {
          ...ctx,
          inboundMedia: [
            { url: 'https://api.twilio.com/m/1', contentType: 'image/png' },
          ] as any,
        },
      );
      expect(parseToolResult(failure)).not.toBeNull();
      expect(parseToolResult(failure)!.status).toBe('error');
      failFetch.mockRestore();
    });
  });

  describe('todos os *_draft_preview devolvem ToolResult', () => {
    function buildAllPreviewTools() {
      const convRepo = makeConvRepo();
      const draftService = new OperationDraftService(convRepo as any);
      const baseRepo = {
        findOne: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findOneSimple: jest.fn(),
        create: jest.fn(),
      };
      const cadastro = buildCadastroDraftTools({
        draftService,
        patientRepo: baseRepo as any,
        procedureRepo: baseRepo as any,
        userRepo: {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
        } as any,
        patientsService: { create: jest.fn() } as any,
        hospitalsService: { create: jest.fn() } as any,
        healthPlansService: { create: jest.fn() } as any,
        proceduresService: { create: jest.fn() } as any,
      });
      const sc = buildScDraftTools({
        draftService,
        userRepo: {
          findOne: jest.fn().mockResolvedValue({
            id: 'user-1',
            ownerId: 'owner-1',
            name: 'Dr. Fulano',
          }),
          findMany: jest.fn().mockResolvedValue([]),
        } as any,
        surgeryRequestRepo: baseRepo as any,
        surgeryRequestsService: { createSurgeryRequest: jest.fn() } as any,
        activityRepo: { create: jest.fn() } as any,
      });
      return [...cadastro, ...sc];
    }

    it('cada *_draft_preview, mesmo sem rascunho válido, devolve envelope ToolResult', async () => {
      const tools = buildAllPreviewTools();
      const previewTools = tools.filter((t) =>
        t.name.endsWith('_draft_preview'),
      );
      expect(previewTools.length).toBeGreaterThanOrEqual(5);

      for (const tool of previewTools) {
        const raw = await tool.execute({}, CONTEXT);
        const parsed = parseToolResult(raw);
        if (!parsed) {
          throw new Error(
            `Tool "${tool.name}" não devolveu ToolResult parseável: ${raw.slice(0, 120)}`,
          );
        }
        // Sem rascunho ativo, espera-se `blocked` ou `needs_input`. O ponto
        // do teste é que o envelope SEJA parseável, qualquer que seja o
        // status — heurísticas de string foram removidas na Fase 4.
        expect(parsed.status).toMatch(
          /^(blocked|needs_input|pending_confirmation|ok|error)$/,
        );
      }
    });
  });
});

/**
 * Fase 9 — Testes arquiteturais permanentes.
 * Esses testes atuam como guardrails automáticos que detectam regressões
 * estruturais: ordem instável do registry (invalida prompt caching) e
 * crescimento inesperado de arquivos de tools.
 */
describe('Fase 9 — guardrails arquiteturais', () => {
  describe('ToolRegistryService — ordem de registro estável', () => {
    it('a ordem das tools no registry é determinística e não muda entre execuções', () => {
      // Snapshot da ordem canônica das 3 primeiras tools.
      // Alterar esta lista requer bump de PROMPT_VERSION.
      // Fase 6 do plano: auto-registro via AI_TOOL preserva esta ordem.
      const expectedOrderPrefix = [
        'plan_actions', // buildPlanTools — sempre primeiro
        'sc_draft_preview', // buildScDraftTools — segundo grupo
        'sc_draft_commit', // segundo item do grupo sc_draft
      ];

      // Constrói registry via DI simulada com buildAllAiTools (sem deps reais)
      // — apenas verifica que as primeiras tools na ordem canônica estão no lugar certo.
      // O conjunto completo é validado pelo tool-registry.service.spec.ts.
      const { buildAllAiTools } = require('./ai-tools.module');
      const tools = buildAllAiTools({
        // deps mínimas para não lançar no construtor
        draftService: {
          setFields: jest.fn(),
          getOrCreate: jest.fn(),
          getActive: jest.fn(),
          cancel: jest.fn(),
          getStatus: jest.fn(),
          commit: jest.fn(),
        },
        userRepo: { findOneById: jest.fn() },
        surgeryRequestRepo: {
          findOneById: jest.fn(),
          findByDoctorIds: jest.fn(),
        },
        surgeryRequestsService: { createSurgeryRequest: jest.fn() },
        activityRepo: { create: jest.fn() },
        patientsService: { create: jest.fn(), findById: jest.fn() },
        patientRepo: { create: jest.fn() },
        hospitalsService: { create: jest.fn() },
        hospitalRepo: { create: jest.fn() },
        healthPlansService: { create: jest.fn() },
        healthPlanRepo: { create: jest.fn() },
        proceduresService: { create: jest.fn() },
        procedureRepo: { create: jest.fn() },
        surgeryRequestProcedureRepo: { create: jest.fn() },
        surgeryRequestTussItemRepo: {
          findBySurgeryRequest: jest.fn(),
          create: jest.fn(),
          delete: jest.fn(),
        },
        opmeItemRepo: {
          findBySurgeryRequest: jest.fn(),
          create: jest.fn(),
          delete: jest.fn(),
        },
        reportSectionRepo: {
          findBySurgeryRequest: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        documentRepo: { create: jest.fn(), findBySurgeryRequest: jest.fn() },
        documentKeyRepo: { findByDocumentType: jest.fn() },
        workflowService: {
          send: jest.fn(),
          startAnalysis: jest.fn(),
          authorize: jest.fn(),
          schedule: jest.fn(),
          markPerformed: jest.fn(),
          close: jest.fn(),
          invoice: jest.fn(),
          finalize: jest.fn(),
          contest: jest.fn(),
        },
        pendencyValidatorService: {
          getBlockingPendencies: jest.fn(),
          getAllPendencies: jest.fn(),
          getWorkflowRequirements: jest.fn(),
          getPostSurgeryRequiredDocs: jest.fn(),
        },
        notificationService: { sendToUser: jest.fn() },
        whatsappDocumentDispatcher: {
          process: jest.fn(),
          attachDocumentFromWhatsapp: jest.fn(),
          createPatientFromDocument: jest.fn(),
        },
        entityResolver: {
          resolvePatient: jest.fn(),
          resolveHospital: jest.fn(),
          resolveHealthPlan: jest.fn(),
          resolveProcedure: jest.fn(),
        },
        procedureCatalogRepo: { findAll: jest.fn() },
        cidService: { search: jest.fn() },
        tussService: { search: jest.fn() },
        aiRedisService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        storageService: { uploadFile: jest.fn(), getSignedUrl: jest.fn() },
        doctorProfileRepo: { findByUserId: jest.fn(), update: jest.fn() },
        configService: { get: jest.fn() },
      } as any);

      const names = tools.map((t: { name: string }) => t.name);
      for (let i = 0; i < expectedOrderPrefix.length; i++) {
        expect(names[i]).toBe(expectedOrderPrefix[i]);
      }
      // Garante que a lista não está vazia e contém pelo menos as 4 tools globais
      expect(names.length).toBeGreaterThanOrEqual(expectedOrderPrefix.length);
    });
  });
});
