import { buildWhatsappFlowTools } from './whatsapp-flow.tools';
import { ToolContext } from './tool.interface';
import { SendMethod } from '../../constants/send-method';
import { PiiVaultService } from '../services/pii-vault.service';

const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  update: jest.fn(),
};
const mockWorkflowService = {
  confirmDate: jest.fn(),
  updateDateOptions: jest.fn(),
  reschedule: jest.fn(),
  markPerformed: jest.fn(),
  invoiceRequest: jest.fn(),
  confirmReceipt: jest.fn(),
  contestAuthorization: jest.fn(),
  contestPayment: jest.fn(),
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
};
const mockActivityRepo = { create: jest.fn() };
const mockPendencyValidator = { validateForStatus: jest.fn() };
const mockPatientRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
};
const mockHospitalRepo = { findOne: jest.fn(), create: jest.fn() };
const mockHealthPlanRepo = { findOne: jest.fn(), create: jest.fn() };
const mockProcedureRepo = { findOne: jest.fn(), findMany: jest.fn() };
const mockUserRepo = { findMany: jest.fn() };
const mockTussItemRepo = { create: jest.fn() };
const mockOpmeItemRepo = { create: jest.fn() };
const mockSupplierRepo = { findMany: jest.fn(), create: jest.fn() };
const mockDocumentRepo = { create: jest.fn() };
const mockStorageService = { create: jest.fn() };
const mockConfigService = { get: jest.fn() };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

const mockRequest = {
  id: 'req-1',
  protocol: 'SC-0042',
  doctor_id: 'doctor-1',
};

describe('WhatsappFlowTools', () => {
  const tools = buildWhatsappFlowTools(
    mockSurgeryRequestRepo as any,
    mockWorkflowService as any,
    mockSurgeryRequestsService as any,
    mockActivityRepo as any,
    mockPendencyValidator as any,
    mockPatientRepo as any,
    mockHospitalRepo as any,
    mockHealthPlanRepo as any,
    mockProcedureRepo as any,
    mockUserRepo as any,
    mockTussItemRepo as any,
    mockOpmeItemRepo as any,
    mockDocumentRepo as any,
    mockStorageService as any,
    mockConfigService as any,
    undefined,
    mockSupplierRepo as any,
  );

  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
    mockConfigService.get.mockReturnValue('');
    mockProcedureRepo.findOne.mockResolvedValue({
      id: 'proc-1',
      name: 'Artroscopia de Joelho',
    });
    mockSupplierRepo.findMany.mockResolvedValue([]);
    mockSupplierRepo.create.mockImplementation(({ name, doctor_id }: any) =>
      Promise.resolve({ id: `sup-${name}`, name, doctor_id }),
    );
    mockPendencyValidator.validateForStatus.mockResolvedValue({
      pendencies: [
        { name: 'Laudo médico', isComplete: false, isOptional: false },
      ],
    });
  });

  describe('create_surgery_request_from_whatsapp', () => {
    it('deve pedir doctor_id quando houver múltiplos médicos acessíveis', async () => {
      const result = await getTool(
        'create_surgery_request_from_whatsapp',
      ).execute(
        {
          procedure_name: 'Artroscopia de Joelho',
          patient_name: 'João',
          patient_phone: '(11) 99999-0000',
        },
        {
          ...baseContext,
          accessibleDoctorIds: ['doctor-1', 'doctor-2'],
        },
      );

      expect(result).toContain('doctor_id');
      expect(result).toContain('doctor-1');
    });

    it('deve validar ausência de procedimento', async () => {
      const result = await getTool(
        'create_surgery_request_from_whatsapp',
      ).execute(
        {
          patient_name: 'João',
          patient_phone: '(11) 99999-0000',
        },
        baseContext,
      );

      expect(result).toContain('procedure_id');
    });

    it('deve orientar quando paciente informado não estiver cadastrado', async () => {
      mockPatientRepo.findMany = jest.fn().mockResolvedValue([]);

      const result = await getTool(
        'create_surgery_request_from_whatsapp',
      ).execute(
        {
          patient_name: 'João',
          procedure_name: 'Artroscopia de Joelho',
        },
        baseContext,
      );

      expect(result).toContain('Paciente não encontrado');
    });

    it('deve retornar preview sem criar dados quando confirm=false', async () => {
      mockPatientRepo.findMany = jest.fn().mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Maria Silva',
        },
      ]);
      mockHospitalRepo.findOne.mockResolvedValue({
        id: 'hosp-1',
        name: 'Hospital Central',
      });
      mockHealthPlanRepo.findOne.mockResolvedValue({
        id: 'hp-1',
        name: 'Unimed',
      });

      const result = await getTool(
        'create_surgery_request_from_whatsapp',
      ).execute(
        {
          patient_name: 'Maria Silva',
          patient_phone: '(11) 98888-7777',
          procedure_name: 'Artroscopia de Joelho',
          hospital_name: 'Hospital Central',
          health_plan_name: 'Unimed',
          priority: 3,
        },
        baseContext,
      );

      expect(result).toContain('Pré-visualização');
      expect(result).toContain('Confirme');
      expect(
        mockSurgeryRequestsService.createSurgeryRequest,
      ).not.toHaveBeenCalled();
      expect(mockPatientRepo.create).not.toHaveBeenCalled();
    });

    it('deve criar solicitação com sucesso quando confirm=true e prioridade default baixa', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation((where: any) => {
        if (where?.id === 'req-99') {
          return Promise.resolve({
            id: 'req-99',
            protocol: 'SC-0099',
            doctor_id: 'doctor-1',
          });
        }
        return Promise.resolve(mockRequest);
      });

      mockPatientRepo.findMany = jest.fn().mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Maria Silva',
        },
      ]);
      mockPatientRepo.create = jest.fn().mockResolvedValue({
        id: 'pat-1',
        name: 'Maria Silva',
        phone: '11988887777',
        email: 'maria@teste.com',
      });
      mockHospitalRepo.findOne.mockResolvedValue({
        id: 'hosp-1',
        name: 'Hospital Central',
      });
      mockHealthPlanRepo.findOne.mockResolvedValue({
        id: 'hp-1',
        name: 'Unimed',
      });
      mockSurgeryRequestsService.createSurgeryRequest = jest
        .fn()
        .mockResolvedValue({
          id: 'req-99',
          protocol: 'SC-0099',
        });

      const result = await getTool(
        'create_surgery_request_from_whatsapp',
      ).execute(
        {
          patient_name: 'Maria Silva',
          procedure_name: 'Artroscopia de Joelho',
          hospital_name: 'Hospital Central',
          health_plan_name: 'Unimed',
          confirm: true,
        },
        baseContext,
      );

      expect(mockPatientRepo.create).not.toHaveBeenCalled();
      expect(mockHospitalRepo.create).not.toHaveBeenCalled();
      expect(mockHealthPlanRepo.create).not.toHaveBeenCalled();
      expect(
        mockSurgeryRequestsService.createSurgeryRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          doctor_id: 'doctor-1',
          patient_id: 'pat-1',
          procedure_id: 'proc-1',
          hospital_id: 'hosp-1',
          health_plan_id: 'hp-1',
          priority: 1,
        }),
        'user-1',
      );
      expect(result).toContain('✅');
      expect(result).toContain('SC-0099');
      expect(result).toContain('Paciente: Maria Silva');
      expect(result).toContain('Pendências para passar para o próximo status');
      expect(result).not.toContain('ID: req-99');
    });
  });

  describe('confirm_date', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('confirm_date').execute(
        { surgery_request_id: 'req-1', selected_date_index: 0 },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar selected_date_index inválido', async () => {
      const result = await getTool('confirm_date').execute(
        { surgery_request_id: 'req-1', selected_date_index: 9, confirm: true },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.confirmDate).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.confirmDate.mockResolvedValue(undefined);

      const result = await getTool('confirm_date').execute(
        { surgery_request_id: 'req-1', selected_date_index: 1, confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'req-1',
        { selected_date_index: 1 },
        'user-1',
      );
      expect(mockActivityRepo.create).toHaveBeenCalled();
      expect(result).toContain('✅');
    });

    it('deve localizar solicitação por protocolo SC-XXXX', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation((where: any) => {
        if (where?.protocol === 'SC-0042') return Promise.resolve(mockRequest);
        return Promise.resolve(null);
      });
      mockWorkflowService.confirmDate.mockResolvedValue(undefined);

      const result = await getTool('confirm_date').execute(
        {
          surgery_request_id: 'SC-0042',
          selected_date_index: 0,
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.findOneSimple).toHaveBeenCalledWith({
        protocol: 'SC-0042',
      });
      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'req-1',
        { selected_date_index: 0 },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('update_date_options', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('update_date_options').execute(
        { surgery_request_id: 'req-1', date_options: ['2026-05-10'] },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar date_options inválido', async () => {
      const result = await getTool('update_date_options').execute(
        {
          surgery_request_id: 'req-1',
          date_options: ['data-invalida'],
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.updateDateOptions).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.updateDateOptions.mockResolvedValue(undefined);

      const result = await getTool('update_date_options').execute(
        {
          surgery_request_id: 'req-1',
          date_options: ['2026-05-10', '2026-05-12'],
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.updateDateOptions).toHaveBeenCalledWith(
        'req-1',
        { date_options: ['2026-05-10', '2026-05-12'] },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('reschedule_surgery', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('reschedule_surgery').execute(
        { surgery_request_id: 'req-1', new_date: '2026-05-10' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar new_date inválida', async () => {
      const result = await getTool('reschedule_surgery').execute(
        {
          surgery_request_id: 'req-1',
          new_date: 'abc',
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
          surgery_request_id: 'req-1',
          new_date: '2026-05-15',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.reschedule).toHaveBeenCalledWith(
        'req-1',
        { new_date: '2026-05-15' },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('mark_performed', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('mark_performed').execute(
        { surgery_request_id: 'req-1', surgery_performed_at: '2026-05-10' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar surgery_performed_at inválida', async () => {
      const result = await getTool('mark_performed').execute(
        {
          surgery_request_id: 'req-1',
          surgery_performed_at: 'invalida',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.markPerformed).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.markPerformed.mockResolvedValue(undefined);

      const result = await getTool('mark_performed').execute(
        {
          surgery_request_id: 'req-1',
          surgery_performed_at: '2026-05-15',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.markPerformed).toHaveBeenCalledWith(
        'req-1',
        { surgery_performed_at: '2026-05-15' },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('invoice_request', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('invoice_request').execute(
        {
          surgery_request_id: 'req-1',
          invoice_protocol: 'INV-1',
          invoice_value: 100,
          invoice_sent_at: '2026-05-10',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('invoice_request').execute(
        {
          surgery_request_id: 'req-1',
          invoice_protocol: '',
          invoice_value: -1,
          invoice_sent_at: 'abc',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.invoiceRequest).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.invoiceRequest.mockResolvedValue(undefined);

      const result = await getTool('invoice_request').execute(
        {
          surgery_request_id: 'req-1',
          invoice_protocol: 'INV-1',
          invoice_value: 1250.5,
          invoice_sent_at: '2026-05-10',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.invoiceRequest).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          invoice_protocol: 'INV-1',
          invoice_value: 1250.5,
          invoice_sent_at: '2026-05-10',
        }),
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('confirm_receipt', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('confirm_receipt').execute(
        {
          surgery_request_id: 'req-1',
          received_value: 100,
          received_at: '2026-05-10',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('confirm_receipt').execute(
        {
          surgery_request_id: 'req-1',
          received_value: -1,
          received_at: 'abc',
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
          surgery_request_id: 'req-1',
          received_value: 900,
          received_at: '2026-05-16',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.confirmReceipt).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          received_value: 900,
          received_at: '2026-05-16',
        }),
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('contest_authorization_full', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('contest_authorization_full').execute(
        {
          surgery_request_id: 'req-1',
          reason: 'Negativa incorreta',
          method: SendMethod.DOWNLOAD,
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar method e dados inválidos', async () => {
      const result = await getTool('contest_authorization_full').execute(
        {
          surgery_request_id: 'req-1',
          reason: 'Teste',
          method: 'invalid',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.contestAuthorization).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.contestAuthorization.mockResolvedValue(undefined);

      const result = await getTool('contest_authorization_full').execute(
        {
          surgery_request_id: 'req-1',
          reason: 'Negativa parcial',
          method: SendMethod.DOWNLOAD,
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.contestAuthorization).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          reason: 'Negativa parcial',
          method: SendMethod.DOWNLOAD,
        }),
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('contest_payment', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'doctor-2',
      });

      const result = await getTool('contest_payment').execute(
        {
          surgery_request_id: 'req-1',
          to: 'financeiro@plano.com',
          subject: 'Contestação',
          message: 'Mensagem',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('contest_payment').execute(
        {
          surgery_request_id: 'req-1',
          to: '',
          subject: 'x',
          message: 'y',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.contestPayment).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.contestPayment.mockResolvedValue(undefined);

      const result = await getTool('contest_payment').execute(
        {
          surgery_request_id: 'req-1',
          to: 'financeiro@plano.com',
          subject: 'Contestação de pagamento',
          message: 'Há divergência de valor.',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.contestPayment).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          to: 'financeiro@plano.com',
          subject: 'Contestação de pagamento',
          message: 'Há divergência de valor.',
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
        doctor_id: 'doctor-2',
      });

      const result = await getTool('update_receipt').execute(
        {
          surgery_request_id: 'req-1',
          received_value: 100,
          received_at: '2026-05-10',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('update_receipt').execute(
        {
          surgery_request_id: 'req-1',
          received_value: -1,
          received_at: 'abc',
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
          surgery_request_id: 'req-1',
          received_value: 1300,
          received_at: '2026-05-20',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.updateReceipt).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          received_value: 1300,
          received_at: '2026-05-20',
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
        doctor_id: 'doctor-2',
      });

      const result = await getTool('manage_report_sections').execute(
        {
          surgery_request_id: 'req-1',
          operation: 'list',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar operação inválida', async () => {
      const result = await getTool('manage_report_sections').execute(
        {
          surgery_request_id: 'req-1',
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
          surgery_request_id: 'req-1',
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
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('hospital_id');
    });

    it('deve atualizar hospital com confirm=true', async () => {
      mockHospitalRepo.findOne.mockResolvedValue({
        id: 'hosp-1',
        name: 'Hospital Central',
      });

      const result = await getTool('set_hospital').execute(
        {
          surgery_request_id: 'req-1',
          hospital_id: 'hosp-1',
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('req-1', {
        hospital_id: 'hosp-1',
      });
      expect(result).toContain('Hospital atualizado com sucesso');
    });
  });

  describe('add_tuss_item', () => {
    it('deve exigir confirmação antes de mutar', async () => {
      const result = await getTool('add_tuss_item').execute(
        {
          surgery_request_id: 'req-1',
          tuss_code: '30401010',
          name: 'Artroscopia',
        },
        baseContext,
      );

      expect(result).toContain('Confirme');
      expect(mockTussItemRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('add_opme_item', () => {
    it('deve exigir ao menos 3 fabricantes e 3 fornecedores', async () => {
      const result = await getTool('add_opme_item').execute(
        {
          surgery_request_id: 'req-1',
          name: 'Parafuso',
          quantity: 2,
          manufacturer_names: ['Fabricante 1', 'Fabricante 2'],
          supplier_names: ['Fornecedor 1', 'Fornecedor 2'],
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('ao menos 3 fabricantes');
      expect(mockOpmeItemRepo.create).not.toHaveBeenCalled();
    });

    it('deve adicionar item OPME e ativar has_opme', async () => {
      const result = await getTool('add_opme_item').execute(
        {
          surgery_request_id: 'req-1',
          name: 'Parafuso',
          quantity: 2,
          manufacturer_names: ['Fabricante 1', 'Fabricante 2', 'Fabricante 3'],
          supplier_names: ['Fornecedor 1', 'Fornecedor 2', 'Fornecedor 3'],
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestsService.setHasOpme).toHaveBeenCalledWith(
        'req-1',
        true,
        'user-1',
      );
      expect(mockOpmeItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          surgery_request_id: 'req-1',
          name: 'Parafuso',
          brand: 'Fabricante 1, Fabricante 2, Fabricante 3',
          quantity: 2,
          suppliers: expect.any(Array),
        }),
      );
      expect(result).toContain('Item OPME adicionado com sucesso');
    });
  });

  describe('update_request_admin_data', () => {
    it('deve validar CPF inválido', async () => {
      const result = await getTool('update_request_admin_data').execute(
        {
          surgery_request_id: 'req-1',
          patient_cpf: '123',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('11 dígitos');
    });

    it('deve atualizar dados administrativos e do paciente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        patient_id: 'pat-1',
      });

      const result = await getTool('update_request_admin_data').execute(
        {
          surgery_request_id: 'req-1',
          health_plan_registration: 'REG-123',
          patient_phone: '(11) 99999-0000',
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ health_plan_registration: 'REG-123' }),
      );
      expect(mockPatientRepo.update).toHaveBeenCalled();
      expect(result).toContain('Dados administrativos atualizados');
    });
  });

  describe('attach_document_from_whatsapp', () => {
    it('deve bloquear quando não houver mídia no contexto', async () => {
      const result = await getTool('attach_document_from_whatsapp').execute(
        {
          surgery_request_id: 'req-1',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('Não identifiquei mídia');
    });

    it('deve anexar documento via mídia inbound com confirm=true', async () => {
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/pdf' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as any);

      mockStorageService.create.mockResolvedValue('documents/doc-1.pdf');
      mockDocumentRepo.create.mockResolvedValue({ id: 'doc-1' });

      const result = await getTool('attach_document_from_whatsapp').execute(
        {
          surgery_request_id: 'req-1',
          document_name: 'Laudo',
          confirm: true,
        },
        {
          ...baseContext,
          inboundMedia: [
            {
              url: 'https://api.twilio.com/2010-04-01/media/1',
              contentType: 'application/pdf',
            },
          ],
        },
      );

      expect(mockStorageService.create).toHaveBeenCalled();
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          surgery_request_id: 'req-1',
          type: 'medical_report',
        }),
      );
      expect(result).toContain('Documento anexado com sucesso');

      fetchMock.mockRestore();
    });
  });

  describe('list_sc_creation_catalog (PII)', () => {
    it('com vault ativo, tokeniza nomes de pacientes/hospitais/convênios antes de retornar à IA', async () => {
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

      expect(result).not.toContain('Maria do Carmo');
      expect(result).not.toContain('José Pereira');
      expect(result).toContain('{{patient_name_1}}');
      expect(result).toContain('{{patient_name_2}}');

      const detok = piiVault.detokenize('conv-1', result);
      expect(detok).toContain('Maria do Carmo');
      expect(detok).toContain('José Pereira');
    });
  });
});
