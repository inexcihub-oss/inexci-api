import { buildWhatsappFlowTools } from './whatsapp-flow.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';
import { EntityResolverService } from '../services/entity-resolver.service';
import { parseToolResult } from './tool-result';

const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  update: jest.fn(),
};
const mockWorkflowService = {
  reschedule: jest.fn(),
  confirmReceipt: jest.fn(),
  updateReceipt: jest.fn(),
};
const mockSurgeryRequestsService = {
  createSurgeryRequest: jest.fn(),
  getReportSections: jest.fn(),
  createReportSection: jest.fn(),
  updateReportSection: jest.fn(),
  deleteReportSection: jest.fn(),
  reorderReportSections: jest.fn(),
  setHasOpme: jest.fn(),
  updateBasic: jest.fn().mockResolvedValue({}),
};
const mockPatientsService = {
  create: jest.fn().mockResolvedValue({ id: 'pat-99', name: 'João da Silva' }),
};
const mockActivityRepo = { create: jest.fn() };
const mockPendencyValidator = { validateForStatus: jest.fn() };
const mockPatientRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
};
const mockHospitalRepo = {
  findOne: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
};
const mockHealthPlanRepo = {
  findOne: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
};
const mockProcedureRepo = { findOne: jest.fn(), findMany: jest.fn() };
const mockUserRepo = { findMany: jest.fn() };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

const mockRequest = {
  id: 'req-1',
  protocol: 'SC-0042',
  doctorId: 'doctor-1',
  ownerId: 'owner-1',
  // Status Pendente: alterações em informações gerais, TUSS, OPME e laudo
  // só são permitidas enquanto a SC está em PENDING.
  status: 1,
};

const mockSentRequest = { ...mockRequest, status: 2 };

describe('WhatsappFlowTools', () => {
  const tools = buildWhatsappFlowTools(
    mockSurgeryRequestRepo as any,
    mockWorkflowService as any,
    mockSurgeryRequestsService as any,
    mockActivityRepo as any,
    {
      documentsService: { createFromPath: jest.fn(), delete: jest.fn() } as any,
    },
    mockPendencyValidator as any,
    mockPatientRepo as any,
    mockHospitalRepo as any,
    mockHealthPlanRepo as any,
    mockProcedureRepo as any,
    mockUserRepo as any,
    undefined,
    new EntityResolverService(),
    mockPatientsService as any,
  );

  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
    mockProcedureRepo.findOne.mockResolvedValue({
      id: 'proc-1',
      name: 'Artroscopia de Joelho',
    });
    mockPendencyValidator.validateForStatus.mockResolvedValue({
      pendencies: [
        { name: 'Laudo médico', isComplete: false, isOptional: false },
      ],
    });
  });

  // describe('create_surgery_request_from_whatsapp', …) removido em 2026-05-12
  // (Fase 3.1 do PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA). A tool legacy foi
  // excluída do registry; os cenários equivalentes (resolução por nome,
  // ambiguidade, hospital/convênio opcional, preview/commit) já são cobertos
  // pelo `sc-draft.tools.spec.ts`.
  it('não expõe mais a tool legacy create_surgery_request_from_whatsapp', () => {
    expect(
      tools.find((t) => t.name === 'create_surgery_request_from_whatsapp'),
    ).toBeUndefined();
  });

  // Tools legacy `confirm_date` e `update_date_options` removidas em 2026-05-12
  // (Sub-fase 3.6 do PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA). Os cenários
  // equivalentes (validação de índice/data, permissão, preview/commit) agora
  // são cobertos pelos testes de `scheduling_draft_*` em
  // `flow-draft.tools.spec.ts`.
  it('não expõe mais as tools legacy confirm_date e update_date_options', () => {
    expect(tools.find((t) => t.name === 'confirm_date')).toBeUndefined();
    expect(tools.find((t) => t.name === 'update_date_options')).toBeUndefined();
  });

  describe('reschedule_surgery', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('reschedule_surgery').execute(
        { surgeryRequestId: 'req-1', newDate: '2026-05-10' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar newDate inválida', async () => {
      const result = await getTool('reschedule_surgery').execute(
        {
          surgeryRequestId: 'req-1',
          newDate: 'abc',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.reschedule).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.reschedule.mockResolvedValue(undefined);

      const result = await getTool('reschedule_surgery').execute(
        {
          surgeryRequestId: 'req-1',
          newDate: '2026-05-15',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.reschedule).toHaveBeenCalledWith(
        'req-1',
        { newDate: '2026-05-15' },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  // Tool legacy `mark_performed` removida em 2026-05-12 (Sub-fase 3.7 do
  // PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA). Os cenários equivalentes
  // (validação de data, permissão, preview/commit) — agora também com
  // checagem de documentos pós-cirúrgicos obrigatórios — são cobertos
  // pelos testes de `mark_performed_draft_*` em
  // `flow-draft-transition.tools.spec.ts`.
  it('não expõe mais a tool legacy mark_performed', () => {
    expect(tools.find((t) => t.name === 'mark_performed')).toBeUndefined();
  });

  describe('confirm_receipt', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('confirm_receipt').execute(
        {
          surgeryRequestId: 'req-1',
          receivedValue: 100,
          receivedAt: '2026-05-10',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('confirm_receipt').execute(
        {
          surgeryRequestId: 'req-1',
          receivedValue: -1,
          receivedAt: 'abc',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.confirmReceipt).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.confirmReceipt.mockResolvedValue(undefined);

      const result = await getTool('confirm_receipt').execute(
        {
          surgeryRequestId: 'req-1',
          receivedValue: 900,
          receivedAt: '2026-05-16',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.confirmReceipt).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          receivedValue: 900,
          receivedAt: '2026-05-16',
        }),
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('update_receipt', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('update_receipt').execute(
        {
          surgeryRequestId: 'req-1',
          receivedValue: 100,
          receivedAt: '2026-05-10',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('update_receipt').execute(
        {
          surgeryRequestId: 'req-1',
          receivedValue: -1,
          receivedAt: 'abc',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.updateReceipt).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.updateReceipt.mockResolvedValue(undefined);

      const result = await getTool('update_receipt').execute(
        {
          surgeryRequestId: 'req-1',
          receivedValue: 1300,
          receivedAt: '2026-05-20',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.updateReceipt).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          receivedValue: 1300,
          receivedAt: '2026-05-20',
        }),
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('manage_report_sections', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('manage_report_sections').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'list',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar operação inválida', async () => {
      const result = await getTool('manage_report_sections').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'invalid',
        },
        baseContext,
      );

      expect(result).toContain('inválido');
    });

    it('deve executar criação com sucesso', async () => {
      mockSurgeryRequestsService.createReportSection.mockResolvedValue({
        id: 'sec-1',
        title: 'Histórico',
      });

      const result = await getTool('manage_report_sections').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'create',
          title: 'Histórico',
          description: 'Descrição',
          confirm: true,
        },
        baseContext,
      );

      expect(
        mockSurgeryRequestsService.createReportSection,
      ).toHaveBeenCalledWith(
        'req-1',
        {
          title: 'Histórico',
          description: 'Descrição',
        },
        'user-1',
      );
      expect(mockActivityRepo.create).toHaveBeenCalled();
      expect(result).toContain('✅');
    });
  });

  describe('set_hospital', () => {
    it('deve validar parâmetros mínimos', async () => {
      const result = await getTool('set_hospital').execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('hospitalId');
    });

    it('deve atualizar hospital com confirm=true', async () => {
      mockHospitalRepo.findOne.mockResolvedValue({
        id: 'hosp-1',
        name: 'Hospital Central',
      });

      const result = await getTool('set_hospital').execute(
        {
          surgeryRequestId: 'req-1',
          hospitalId: 'hosp-1',
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestsService.updateBasic).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-1', hospitalId: 'hosp-1' }),
        'user-1',
      );
      expect(result).toContain('Hospital atualizado com sucesso');
    });

    it('fuzzy: hospital_name parcial casa por similaridade (Einstein → Hospital Israelita Albert Einstein)', async () => {
      // Match exato falha; usa findMany e EntityResolverService.
      mockHospitalRepo.findOne.mockResolvedValue(null);
      mockHospitalRepo.findMany.mockResolvedValue([
        { id: 'h-1', name: 'Hospital Israelita Albert Einstein' },
        { id: 'h-2', name: 'Hospital Sírio-Libanês' },
      ]);

      const result = await getTool('set_hospital').execute(
        {
          surgeryRequestId: 'req-1',
          hospital_name: 'Einstein',
          confirm: true,
        },
        baseContext,
      );
      expect(mockSurgeryRequestsService.updateBasic).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-1', hospitalId: 'h-1' }),
        'user-1',
      );
      expect(result).toContain('Hospital atualizado com sucesso');
    });

    it('deve permitir remover hospital com clear=true', async () => {
      const result = await getTool('set_hospital').execute(
        {
          surgeryRequestId: 'req-1',
          clear: true,
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestsService.updateBasic).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-1', hospitalId: null }),
        'user-1',
      );
      expect(result).toContain('Hospital removido');
    });
  });

  describe('read-only após status Pendente', () => {
    beforeEach(() => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockSentRequest);
    });

    it('set_hospital deve recusar mutação quando SC está em Enviada', async () => {
      const result = await getTool('set_hospital').execute(
        {
          surgeryRequestId: 'req-1',
          hospitalId: 'hosp-1',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(result).toContain('Enviada');
      expect(mockSurgeryRequestsService.updateBasic).not.toHaveBeenCalled();
    });

    it('set_hospital com clear=true também é bloqueado fora de Pendente', async () => {
      const result = await getTool('set_hospital').execute(
        {
          surgeryRequestId: 'req-1',
          clear: true,
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockSurgeryRequestsService.updateBasic).not.toHaveBeenCalled();
    });

    it('manage_report_sections deve permitir list mas recusar create', async () => {
      mockSurgeryRequestsService.getReportSections = jest
        .fn()
        .mockResolvedValue([
          { id: 's1', title: 'Diagnóstico', description: 'desc' },
        ]);

      const listResult = await getTool('manage_report_sections').execute(
        { surgeryRequestId: 'req-1', operation: 'list' },
        baseContext,
      );
      expect(listResult).toContain('Diagnóstico');

      const createResult = await getTool('manage_report_sections').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'create',
          title: 'Nova seção',
          confirm: true,
        },
        baseContext,
      );
      expect(createResult).toContain('histórico');
      expect(
        mockSurgeryRequestsService.createReportSection,
      ).not.toHaveBeenCalled();
    });
  });

  describe('list_sc_creation_catalog (PII)', () => {
    it('com vault ativo, mantém nomes de pacientes/hospitais/convênios em claro (refatoração de drafts: matching por similaridade)', async () => {
      mockPatientRepo.findMany = jest.fn().mockResolvedValue([
        { id: 'pat-1', name: 'Maria do Carmo' },
        { id: 'pat-2', name: 'José Pereira' },
      ]);
      (mockHospitalRepo as any).findMany = jest.fn().mockResolvedValue([]);
      (mockHealthPlanRepo as any).findMany = jest.fn().mockResolvedValue([]);
      mockUserRepo.findMany.mockResolvedValue([]);
      mockProcedureRepo.findMany.mockResolvedValue([]);
      (mockSurgeryRequestsService as any).getTemplates = jest
        .fn()
        .mockResolvedValue([]);

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('list_sc_creation_catalog');
      const result = await tool.execute(
        { category: 'patients', limit: 5 },
        { ...baseContext, piiVault },
      );

      expect(result).toContain('Maria do Carmo');
      expect(result).toContain('José Pereira');
      expect(result).not.toContain('{{patient_name_');
    });
  });

  // ---------------------------------------------------------------------
  // OCR — tools novas do Sprint 3 (attach_document_from_whatsapp e
  // create_patient_from_document). Construímos um conjunto separado de
  // tools com as deps de documento mockadas para não poluir os testes
  // anteriores do `WhatsappFlowTools`.
  // ---------------------------------------------------------------------
  describe('OCR — attach_document_from_whatsapp', () => {
    const documentDispatcher = {
      getPending: jest.fn(),
      clearPending: jest.fn().mockResolvedValue(undefined),
      deleteStoragePath: jest.fn().mockResolvedValue(undefined),
    };
    const storageService = {
      move: jest.fn().mockResolvedValue('documents/abc-laudo.pdf'),
    };
    const documentRepo = {
      create: jest.fn().mockResolvedValue({
        id: 'doc-99',
        name: 'Laudo Joao.pdf',
        type: 'medical_report',
      }),
    };
    const documentsService = {
      createFromPath: jest.fn().mockResolvedValue({
        id: 'doc-99',
        name: 'Laudo Joao.pdf',
        type: 'medical_report',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const ocrTools = buildWhatsappFlowTools(
      mockSurgeryRequestRepo as any,
      mockWorkflowService as any,
      mockSurgeryRequestsService as any,
      mockActivityRepo as any,
      {
        documentDispatcher: documentDispatcher as any,
        storageService: storageService as any,
        documentRepo: documentRepo as any,
        documentsService: documentsService as any,
      },
      mockPendencyValidator as any,
      mockPatientRepo as any,
      mockHospitalRepo as any,
      mockHealthPlanRepo as any,
      mockProcedureRepo as any,
      mockUserRepo as any,
      undefined,
      new EntityResolverService(),
      mockPatientsService as any,
    );

    const attach = ocrTools.find(
      (t) => t.name === 'attach_document_from_whatsapp',
    )!;

    beforeEach(() => {
      jest.clearAllMocks();
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
      documentDispatcher.getPending.mockResolvedValue({
        storagePath: 'whatsapp-tmp/abc-laudo.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12345,
        fileName: 'Laudo Joao.pdf',
        kind: 'pdf',
        receivedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        messageSid: 'SM-1',
      });
    });

    it('rejeita documentType desconhecido', async () => {
      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'tipo_invalido',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('documentType');
      expect(documentsService.createFromPath).not.toHaveBeenCalled();
    });

    it('mostra preview quando confirm=false', async () => {
      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
        },
        baseContext,
      );

      expect(result).toContain('Pré-visualização');
      expect(result).toContain('Laudo médico');
      expect(documentsService.createFromPath).not.toHaveBeenCalled();
      expect(storageService.move).not.toHaveBeenCalled();
    });

    it('retorna mensagem amigável quando não há pendência ativa', async () => {
      documentDispatcher.getPending.mockResolvedValueOnce(null);

      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('nenhum documento pendente');
      expect(storageService.move).not.toHaveBeenCalled();
    });

    it('move o arquivo, cria o registro e limpa a pendência ao confirmar', async () => {
      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
          documentName: 'Laudo do Joao',
          confirm: true,
        },
        baseContext,
      );

      expect(storageService.move).toHaveBeenCalledWith(
        'whatsapp-tmp/abc-laudo.pdf',
        expect.any(String),
      );
      expect(documentsService.createFromPath).toHaveBeenCalledWith(
        expect.objectContaining({
          surgeryRequestId: 'req-1',
          createdById: 'user-1',
          type: 'medical_report',
          key: 'medical_report',
          name: 'Laudo do Joao',
          storagePath: 'documents/abc-laudo.pdf',
        }),
      );
      expect(mockActivityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          surgeryRequestId: 'req-1',
          content: expect.stringContaining('Documento anexado'),
        }),
      );
      expect(documentDispatcher.clearPending).toHaveBeenCalledWith(
        baseContext.phone,
      );
      expect(documentDispatcher.deleteStoragePath).not.toHaveBeenCalled();
      expect(result).toContain('Documento anexado');
      expect(result).toContain('doc-99');
    });

    it('bloqueia quando o usuário não tem acesso à SC', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValueOnce({
        ...mockRequest,
        doctorId: 'doctor-outro',
      });

      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('permissão');
      expect(storageService.move).not.toHaveBeenCalled();
    });

    it('retorna mensagem de indisponibilidade quando deps de documento ausentes', async () => {
      const noDepsTools = buildWhatsappFlowTools(
        mockSurgeryRequestRepo as any,
        mockWorkflowService as any,
        mockSurgeryRequestsService as any,
        mockActivityRepo as any,
        {
          documentsService: {
            createFromPath: jest.fn(),
            delete: jest.fn(),
          } as any,
        },
        mockPendencyValidator as any,
        mockPatientRepo as any,
        mockHospitalRepo as any,
        mockHealthPlanRepo as any,
        mockProcedureRepo as any,
        mockUserRepo as any,
        undefined,
        new EntityResolverService(),
        mockPatientsService as any,
      );
      const tool = noDepsTools.find(
        (t) => t.name === 'attach_document_from_whatsapp',
      )!;

      const result = await tool.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('finalizado');
    });

    it('envelope: status=pending_confirmation para preview', async () => {
      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
        },
        baseContext,
      );
      const parsed = parseToolResult(result);
      expect(parsed?.status).toBe('pending_confirmation');
      expect(parsed?.pending_confirmation?.tool).toBe(
        'attach_document_from_whatsapp',
      );
    });

    it('envelope: status=ok após confirmação', async () => {
      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
          confirm: true,
        },
        baseContext,
      );
      expect(parseToolResult(result)?.status).toBe('ok');
    });

    it('envelope: status=blocked quando não tem pendência', async () => {
      documentDispatcher.getPending.mockResolvedValueOnce(null);
      const result = await attach.execute(
        {
          surgeryRequestId: 'req-1',
          documentType: 'medical_report',
          confirm: true,
        },
        baseContext,
      );
      expect(parseToolResult(result)?.status).toBe('blocked');
    });
  });

  describe('OCR — create_patient_from_document', () => {
    const documentDispatcher = {
      getPending: jest.fn(),
      clearPending: jest.fn().mockResolvedValue(undefined),
      deleteStoragePath: jest.fn().mockResolvedValue(undefined),
    };

    const mockOcrPatientsService = {
      create: jest.fn().mockResolvedValue({
        id: 'pat-99',
        name: 'João da Silva',
      }),
    };

    const ocrTools = buildWhatsappFlowTools(
      mockSurgeryRequestRepo as any,
      mockWorkflowService as any,
      mockSurgeryRequestsService as any,
      mockActivityRepo as any,
      {
        documentDispatcher: documentDispatcher as any,
        documentsService: {
          createFromPath: jest.fn(),
          delete: jest.fn(),
        } as any,
      },
      mockPendencyValidator as any,
      mockPatientRepo as any,
      mockHospitalRepo as any,
      mockHealthPlanRepo as any,
      mockProcedureRepo as any,
      mockUserRepo as any,
      undefined,
      new EntityResolverService(),
      mockOcrPatientsService as any,
    );
    const createPatient = ocrTools.find(
      (t) => t.name === 'create_patient_from_document',
    )!;

    beforeEach(() => {
      jest.clearAllMocks();
      mockUserRepo.findMany.mockReset();
      (mockUserRepo as any).findOne = jest
        .fn()
        .mockImplementation(({ id }: any) => {
          if (id === 'doctor-1')
            return Promise.resolve({ id: 'doctor-1', name: 'Dr. House' });
          if (id === 'user-1')
            return Promise.resolve({ id: 'user-1', ownerId: 'owner-1' });
          return Promise.resolve(null);
        });
      mockPatientRepo.findMany.mockResolvedValue([]);
      mockOcrPatientsService.create.mockResolvedValue({
        id: 'pat-99',
        name: 'João da Silva',
      });
      documentDispatcher.getPending.mockResolvedValue(null);
    });

    it('bloqueia quando o nome é muito curto', async () => {
      const result = await createPatient.execute(
        { name: 'A', phone: '11988887777', email: 'a@a.com', confirm: true },
        baseContext,
      );

      expect(result).toContain('name');
      expect(mockOcrPatientsService.create).not.toHaveBeenCalled();
    });

    it('mostra preview quando confirm=false', async () => {
      const result = await createPatient.execute(
        {
          name: 'João da Silva',
          cpf: '52998224725',
          phone: '11988887777',
          email: 'joao@silva.com',
        },
        baseContext,
      );

      expect(result).toContain('Confirme a criação');
      expect(result).toContain('João da Silva');
      expect(result).toContain('joao@silva.com');
      expect(mockOcrPatientsService.create).not.toHaveBeenCalled();
    });

    it('cria paciente, limpa pendência e devolve mensagem de sucesso', async () => {
      documentDispatcher.getPending.mockResolvedValueOnce({
        storagePath: 'whatsapp-tmp/rg.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 4321,
        fileName: 'rg.jpg',
        kind: 'image',
        receivedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        messageSid: 'SM-2',
      });

      const result = await createPatient.execute(
        {
          name: 'João da Silva',
          phone: '11988887777',
          email: 'joao@silva.com',
          cpf: '52998224725',
          birth_date: '1990-05-10',
          gender: 'M',
          confirm: true,
        },
        baseContext,
      );

      expect(mockOcrPatientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'João da Silva',
          email: 'joao@silva.com',
          phone: '11988887777',
          cpf: '52998224725',
          gender: 'M',
        }),
        'user-1',
      );
      expect(documentDispatcher.deleteStoragePath).toHaveBeenCalledWith(
        'whatsapp-tmp/rg.jpg',
      );
      expect(documentDispatcher.clearPending).toHaveBeenCalledWith(
        baseContext.phone,
      );
      expect(result).toContain('cadastrado com sucesso');
      expect(result).toContain('solicitação cirúrgica');
    });

    it('avisa quando CPF já está cadastrado nesta clínica', async () => {
      mockPatientRepo.findMany.mockResolvedValueOnce([
        { id: 'pat-existente', name: 'Maria de Souza' },
      ]);

      const result = await createPatient.execute(
        {
          name: 'Maria de Souza',
          phone: '11988887777',
          email: 'maria@souza.com',
          cpf: '52998224725',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('Já existe paciente');
      expect(mockOcrPatientsService.create).not.toHaveBeenCalled();
    });

    it('envelope: status=pending_confirmation para preview', async () => {
      const result = await createPatient.execute(
        {
          name: 'Pedro Santos',
          cpf: '52998224725',
          phone: '11977776666',
          email: 'pedro@santos.com',
        },
        baseContext,
      );
      const parsed = parseToolResult(result);
      expect(parsed?.status).toBe('pending_confirmation');
      expect(parsed?.pending_confirmation?.tool).toBe(
        'create_patient_from_document',
      );
    });

    it('envelope: status=ok após criação com confirm', async () => {
      const result = await createPatient.execute(
        {
          name: 'Pedro Santos',
          cpf: '52998224725',
          phone: '11977776666',
          email: 'pedro@santos.com',
          confirm: true,
        },
        baseContext,
      );
      const parsed = parseToolResult(result);
      expect(parsed?.status).toBe('ok');
      expect(parsed?.affected?.[0]?.kind).toBe('patient');
    });

    it('envelope: status=blocked quando sem userId', async () => {
      const result = await createPatient.execute(
        { name: 'Pedro Santos', phone: '11977776666', email: 'pedro@s.com' },
        { ...baseContext, userId: null },
      );
      expect(parseToolResult(result)?.status).toBe('blocked');
    });
  });

  // Regressão Sub-fase 3.8 (PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA):
  // `update_request_clinical_data` e `update_request_admin_data` foram removidas.
  it('não expõe mais update_request_clinical_data nem update_request_admin_data', () => {
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('update_request_clinical_data');
    expect(names).not.toContain('update_request_admin_data');
  });

  // ----------------------------------------------------------------
  // Fase 2 PLANO-CORRECOES-CODE-REVIEW-2026-05-13: envelope ToolResult
  // Cada tool migrada deve retornar JSON parseável com status correto.
  // ----------------------------------------------------------------
  describe('envelope ToolResult — Fase 2', () => {
    describe('reschedule_surgery', () => {
      it('status=pending_confirmation quando sem confirm', async () => {
        const result = await getTool('reschedule_surgery').execute(
          { surgeryRequestId: 'req-1', newDate: '2026-06-01' },
          baseContext,
        );
        const parsed = parseToolResult(result);
        expect(parsed?.status).toBe('pending_confirmation');
        expect(parsed?.pending_confirmation?.tool).toBe('reschedule_surgery');
      });

      it('status=ok após execução com confirm', async () => {
        mockWorkflowService.reschedule.mockResolvedValue(undefined);
        const result = await getTool('reschedule_surgery').execute(
          { surgeryRequestId: 'req-1', newDate: '2026-06-01', confirm: true },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('ok');
      });

      it('status=blocked quando sem permissão', async () => {
        mockSurgeryRequestRepo.findOneSimple.mockResolvedValueOnce({
          ...mockRequest,
          doctorId: 'doctor-outro',
        });
        const result = await getTool('reschedule_surgery').execute(
          { surgeryRequestId: 'req-1', newDate: '2026-06-01' },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('blocked');
      });
    });

    describe('confirm_receipt', () => {
      it('status=pending_confirmation quando sem confirm', async () => {
        const result = await getTool('confirm_receipt').execute(
          {
            surgeryRequestId: 'req-1',
            receivedValue: 1000,
            receivedAt: '2026-06-01',
          },
          baseContext,
        );
        const parsed = parseToolResult(result);
        expect(parsed?.status).toBe('pending_confirmation');
        expect(parsed?.pending_confirmation?.tool).toBe('confirm_receipt');
      });

      it('status=ok após execução com confirm', async () => {
        mockWorkflowService.confirmReceipt.mockResolvedValue(undefined);
        const result = await getTool('confirm_receipt').execute(
          {
            surgeryRequestId: 'req-1',
            receivedValue: 1000,
            receivedAt: '2026-06-01',
            confirm: true,
          },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('ok');
      });

      it('status=blocked quando sem permissão', async () => {
        mockSurgeryRequestRepo.findOneSimple.mockResolvedValueOnce({
          ...mockRequest,
          doctorId: 'doctor-outro',
        });
        const result = await getTool('confirm_receipt').execute(
          {
            surgeryRequestId: 'req-1',
            receivedValue: 1000,
            receivedAt: '2026-06-01',
          },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('blocked');
      });
    });

    describe('update_receipt', () => {
      it('status=pending_confirmation quando sem confirm', async () => {
        const result = await getTool('update_receipt').execute(
          {
            surgeryRequestId: 'req-1',
            receivedValue: 1200,
            receivedAt: '2026-06-02',
          },
          baseContext,
        );
        const parsed = parseToolResult(result);
        expect(parsed?.status).toBe('pending_confirmation');
        expect(parsed?.pending_confirmation?.tool).toBe('update_receipt');
      });

      it('status=ok após execução com confirm', async () => {
        mockWorkflowService.updateReceipt.mockResolvedValue(undefined);
        const result = await getTool('update_receipt').execute(
          {
            surgeryRequestId: 'req-1',
            receivedValue: 1200,
            receivedAt: '2026-06-02',
            confirm: true,
          },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('ok');
      });

      it('status=blocked quando sem permissão', async () => {
        mockSurgeryRequestRepo.findOneSimple.mockResolvedValueOnce({
          ...mockRequest,
          doctorId: 'doctor-outro',
        });
        const result = await getTool('update_receipt').execute(
          {
            surgeryRequestId: 'req-1',
            receivedValue: 1200,
            receivedAt: '2026-06-02',
          },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('blocked');
      });
    });

    describe('set_hospital', () => {
      it('status=pending_confirmation quando sem confirm', async () => {
        mockHospitalRepo.findOne.mockResolvedValueOnce({
          id: 'hosp-1',
          name: 'Hospital X',
        });
        const result = await getTool('set_hospital').execute(
          { surgeryRequestId: 'req-1', hospitalId: 'hosp-1' },
          baseContext,
        );
        const parsed = parseToolResult(result);
        expect(parsed?.status).toBe('pending_confirmation');
        expect(parsed?.pending_confirmation?.tool).toBe('set_hospital');
      });

      it('status=ok após execução com confirm', async () => {
        mockHospitalRepo.findOne.mockResolvedValueOnce({
          id: 'hosp-1',
          name: 'Hospital X',
        });
        const result = await getTool('set_hospital').execute(
          { surgeryRequestId: 'req-1', hospitalId: 'hosp-1', confirm: true },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('ok');
      });

      it('status=blocked quando SC fora de Pendente', async () => {
        mockSurgeryRequestRepo.findOneSimple.mockResolvedValueOnce(
          mockSentRequest,
        );
        const result = await getTool('set_hospital').execute(
          { surgeryRequestId: 'req-1', hospitalId: 'hosp-1', confirm: true },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('blocked');
      });
    });

    describe('manage_report_sections', () => {
      it('status=pending_confirmation para create sem confirm', async () => {
        const result = await getTool('manage_report_sections').execute(
          {
            surgeryRequestId: 'req-1',
            operation: 'create',
            title: 'Anamnese',
          },
          baseContext,
        );
        const parsed = parseToolResult(result);
        expect(parsed?.status).toBe('pending_confirmation');
        expect(parsed?.pending_confirmation?.tool).toBe(
          'manage_report_sections',
        );
      });

      it('status=ok para list', async () => {
        mockSurgeryRequestsService.getReportSections = jest
          .fn()
          .mockResolvedValue([{ id: 's1', title: 'Anamnese' }]);
        const result = await getTool('manage_report_sections').execute(
          { surgeryRequestId: 'req-1', operation: 'list' },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('ok');
      });

      it('status=blocked para mutação fora de Pendente', async () => {
        mockSurgeryRequestRepo.findOneSimple.mockResolvedValueOnce(
          mockSentRequest,
        );
        const result = await getTool('manage_report_sections').execute(
          {
            surgeryRequestId: 'req-1',
            operation: 'create',
            title: 'Anamnese',
            confirm: true,
          },
          baseContext,
        );
        expect(parseToolResult(result)?.status).toBe('blocked');
      });
    });
  });
});
