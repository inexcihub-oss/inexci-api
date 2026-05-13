import { ConflictException } from '@nestjs/common';
import { buildCadastroDraftTools } from './cadastro-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('cadastro draft tools (preview + commit)', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let mockPatientRepo: any;
  let mockProcedureRepo: any;
  let mockUserRepo: any;
  let mockPatientsService: any;
  let mockHospitalsService: any;
  let mockHealthPlansService: any;
  let mockProceduresService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

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

    mockPatientRepo = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    mockProcedureRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    mockUserRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
    };

    mockPatientsService = {
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-pat',
        name: data.name,
        phone: data.phone,
        email: data.email,
      })),
    };
    mockHospitalsService = {
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-h',
        name: data.name,
      })),
    };
    mockHealthPlansService = {
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-hp',
        name: data.name,
      })),
    };
    mockProceduresService = {
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-pro',
        name: data.name,
      })),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: mockPatientRepo,
      procedureRepo: mockProcedureRepo,
      userRepo: mockUserRepo,
      patientsService: mockPatientsService,
      hospitalsService: mockHospitalsService,
      healthPlansService: mockHealthPlansService,
      proceduresService: mockProceduresService,
    });
  });

  it('expõe apenas preview e commit por entidade (setters/status/cancel migrados para draft_update/draft_status/draft_cancel)', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'patient_draft_preview',
      'patient_draft_commit',
      'hospital_draft_preview',
      'hospital_draft_commit',
      'health_plan_draft_preview',
      'health_plan_draft_commit',
      'procedure_draft_preview',
      'procedure_draft_commit',
    ]);
  });

  describe('create_patient', () => {
    it('preview bloqueia quando faltam campos obrigatórios', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
      });
      const raw = await getTool('patient_draft_preview').execute({}, context);
      const parsed = parseToolResult<any>(raw);
      expect(['needs_input', 'blocked']).toContain(parsed?.status);
    });

    it('fluxo completo: setFields → preview → commit cria paciente', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
      });
      await draftService.setFields('conv-1', 'create_patient', {
        name: 'João da Silva',
        phone: '11912345678',
        doctorId: 'doctor-1',
        doctorLabel: 'Dra. Maria',
      });

      const previewRaw = await getTool('patient_draft_preview').execute(
        {},
        context,
      );
      const previewParsed = parseToolResult<any>(previewRaw);
      expect(previewParsed?.status).toBe('pending_confirmation');

      const noConfirm = await getTool('patient_draft_commit').execute(
        { confirm: false },
        context,
      );
      expect(parseToolResult<any>(noConfirm)?.status).toBe(
        'pending_confirmation',
      );
      expect(mockPatientsService.create).not.toHaveBeenCalled();

      const commitRaw = await getTool('patient_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commitParsed = parseToolResult<any>(commitRaw);
      expect(commitParsed?.status).toBe('ok');
      expect(commitParsed?.data.name).toBe('João da Silva');
      expect(mockPatientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'João da Silva',
          phone: '11912345678',
        }),
        'user-1',
      );
      expect(conv.operationDraft).toBeNull();
    });

    it('bloqueia commit quando há paciente com mesmo CPF', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
      });
      await draftService.setFields('conv-1', 'create_patient', {
        name: 'Ana',
        phone: '11912345678',
        cpf: '52998224725',
        doctorId: 'doctor-1',
        doctorLabel: 'Dra. Maria',
      });
      mockPatientRepo.findMany.mockResolvedValueOnce([
        { id: 'existing-pat', name: 'Ana Existing', cpf: '52998224725' },
      ]);

      const raw = await getTool('patient_draft_commit').execute(
        { confirm: true },
        context,
      );
      const parsed = parseToolResult<any>(raw);
      expect(parsed?.status).toBe('blocked');
      expect(parsed?.data.existingPatientId).toBe('existing-pat');
    });

    it('translada erro de service em ToolResult error', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
      });
      await draftService.setFields('conv-1', 'create_patient', {
        name: 'Carla',
        phone: '11912345678',
        doctorId: 'doctor-1',
        doctorLabel: 'Dra. Maria',
      });
      mockPatientsService.create.mockRejectedValueOnce(
        new ConflictException('telefone já cadastrado'),
      );

      const raw = await getTool('patient_draft_commit').execute(
        { confirm: true },
        context,
      );
      const parsed = parseToolResult<any>(raw);
      expect(parsed?.status).toBe('error');
      expect(parsed?.message).toMatch(/telefone já cadastrado/i);
    });
  });

  describe('create_hospital', () => {
    it('fluxo completo: setFields → preview → commit cria hospital', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_hospital',
      });
      await draftService.setFields('conv-1', 'create_hospital', {
        name: 'Hospital Beneficência Portuguesa',
      });

      const previewRaw = await getTool('hospital_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commitRaw = await getTool('hospital_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commitParsed = parseToolResult<any>(commitRaw);
      expect(commitParsed?.status).toBe('ok');
      expect(mockHospitalsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hospital Beneficência Portuguesa' }),
        'user-1',
      );
    });
  });

  describe('create_health_plan', () => {
    it('fluxo completo: setFields → preview → commit cria convênio', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_health_plan',
      });
      await draftService.setFields('conv-1', 'create_health_plan', {
        name: 'Unimed Recife',
      });

      const previewRaw = await getTool('health_plan_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commitRaw = await getTool('health_plan_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(parseToolResult<any>(commitRaw)?.status).toBe('ok');
      expect(mockHealthPlansService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Unimed Recife' }),
        'user-1',
      );
    });
  });

  describe('create_procedure', () => {
    it('fluxo completo: setFields → preview → commit cria procedimento', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_procedure',
      });
      await draftService.setFields('conv-1', 'create_procedure', {
        name: 'Artroplastia total de quadril',
      });

      const previewRaw = await getTool('procedure_draft_preview').execute(
        {},
        context,
      );
      expect(parseToolResult<any>(previewRaw)?.status).toBe(
        'pending_confirmation',
      );

      const commitRaw = await getTool('procedure_draft_commit').execute(
        { confirm: true },
        context,
      );
      expect(parseToolResult<any>(commitRaw)?.status).toBe('ok');
      expect(mockProceduresService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Artroplastia total de quadril' }),
      );
    });
  });
});
