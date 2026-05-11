import { buildCadastroDraftTools } from './cadastro-draft.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

describe('cadastro draft tools', () => {
  let conv: any;
  let mockConvRepo: any;
  let draftService: OperationDraftService;
  let mockPatientRepo: any;
  let mockHospitalRepo: any;
  let mockHealthPlanRepo: any;
  let mockProcedureRepo: any;
  let mockUserRepo: any;
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
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-pat',
        ...data,
      })),
    };
    mockHospitalRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-h',
        ...data,
      })),
    };
    mockHealthPlanRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-hp',
        ...data,
      })),
    };
    mockProcedureRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (data: any) => ({
        id: 'new-pro',
        ...data,
      })),
    };
    mockUserRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: mockPatientRepo,
      hospitalRepo: mockHospitalRepo,
      healthPlanRepo: mockHealthPlanRepo,
      procedureRepo: mockProcedureRepo,
      userRepo: mockUserRepo,
    });
  });

  describe('create_patient', () => {
    it('guarda bloqueia uso sem draft ativo', async () => {
      const raw = await getTool('patient_draft_set_name').execute(
        { name: 'João da Silva' },
        context,
      );
      const parsed = parseToolResult<any>(raw);
      expect(parsed?.status).toBe('blocked');
    });

    it('fluxo completo: set name/phone → preview → commit cria paciente', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
      });

      await getTool('patient_draft_set_name').execute(
        { name: 'João da Silva' },
        context,
      );
      await getTool('patient_draft_set_phone').execute(
        { phone: '(11) 91234-5678' },
        context,
      );
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
      expect(mockPatientRepo.create).not.toHaveBeenCalled();

      const commitRaw = await getTool('patient_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commitParsed = parseToolResult<any>(commitRaw);
      expect(commitParsed?.status).toBe('ok');
      expect(commitParsed?.data.name).toBe('João da Silva');
      expect(mockPatientRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'João da Silva',
          phone: '11912345678',
          doctorId: 'doctor-1',
          ownerId: 'owner-1',
        }),
      );
      // Draft foi limpo (não há parent).
      expect(conv.operationDraft).toBeNull();
    });

    it('bloqueia commit quando há paciente com mesmo CPF', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
      });
      await getTool('patient_draft_set_name').execute({ name: 'Ana' }, context);
      await getTool('patient_draft_set_phone').execute(
        { phone: '11912345678' },
        context,
      );
      await getTool('patient_draft_set_cpf').execute(
        { cpf: '52998224725' }, // CPF válido fictício
        context,
      );
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
  });

  describe('create_hospital', () => {
    it('fluxo: start → set name → preview → commit', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_hospital',
      });
      await getTool('hospital_draft_set_name').execute(
        { name: 'Hospital Novo' },
        context,
      );
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
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(mockHospitalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hospital Novo', ownerId: 'owner-1' }),
      );
    });

    it('reaproveita cadastro existente quando nome normalizado já existe', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_hospital',
      });
      await getTool('hospital_draft_set_name').execute(
        { name: 'Hospital Já Existe' },
        context,
      );
      mockHospitalRepo.findOne.mockResolvedValueOnce({
        id: 'h-exist',
        name: 'Hospital Já Existe',
        ownerId: 'owner-1',
      });
      const commitRaw = await getTool('hospital_draft_commit').execute(
        { confirm: true },
        context,
      );
      const commit = parseToolResult<any>(commitRaw);
      expect(commit?.status).toBe('ok');
      expect(commit?.data.reused).toBe(true);
      expect(mockHospitalRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('create_health_plan', () => {
    it('fluxo completo', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_health_plan',
      });
      await getTool('health_plan_draft_set_name').execute(
        { name: 'Convênio X' },
        context,
      );
      const commit = parseToolResult<any>(
        await getTool('health_plan_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockHealthPlanRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Convênio X', ownerId: 'owner-1' }),
      );
    });
  });

  describe('create_procedure', () => {
    it('fluxo completo cria procedimento global', async () => {
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_procedure',
      });
      await getTool('procedure_draft_set_name').execute(
        { name: 'Procedimento Novo' },
        context,
      );
      const commit = parseToolResult<any>(
        await getTool('procedure_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');
      expect(mockProcedureRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Procedimento Novo' }),
      );
    });
  });

  describe('sub-drafts', () => {
    it('quando aberto dentro de create_sc, ao commitar restaura o pai e popula patientId', async () => {
      // Pai: create_sc com hospital já preenchido.
      const parent = await draftService.start({
        conversationId: 'conv-1',
        type: 'create_sc',
      });
      await draftService.setFields(conv.id, 'create_sc', {
        hospitalId: 'h-1',
        hospitalLabel: 'Hospital X',
      });

      // Abrir sub-draft create_patient apontando para o pai.
      const parentSnapshot = await draftService.getCurrentOfType(
        conv.id,
        'create_sc',
      );
      await draftService.start({
        conversationId: 'conv-1',
        type: 'create_patient',
        parent: {
          type: 'create_sc',
          returnField: 'patientId',
          snapshot: parentSnapshot,
        },
      });

      await getTool('patient_draft_set_name').execute(
        { name: 'João da Silva' },
        context,
      );
      await getTool('patient_draft_set_phone').execute(
        { phone: '11912345678' },
        context,
      );
      const commit = parseToolResult<any>(
        await getTool('patient_draft_commit').execute(
          { confirm: true },
          context,
        ),
      );
      expect(commit?.status).toBe('ok');

      // Após commit, draft ativo deve voltar a ser create_sc com patientId preenchido.
      const restored = await draftService.getCurrent(conv.id);
      expect(restored?.type).toBe('create_sc');
      expect((restored?.fields as any).patientId).toBe('new-pat');
      expect((restored?.fields as any).patientLabel).toBe('João da Silva');
      // Hospital previamente preenchido foi preservado.
      expect((restored?.fields as any).hospitalId).toBe('h-1');
    });
  });
});
