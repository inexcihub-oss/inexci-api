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
    mockPendencyValidator as any,
    mockPatientRepo as any,
    mockHospitalRepo as any,
    mockHealthPlanRepo as any,
    mockProcedureRepo as any,
    mockUserRepo as any,
    undefined,
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

  describe('create_surgery_request_from_whatsapp', () => {
    it('deve pedir doctorId quando houver múltiplos médicos acessíveis', async () => {
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

      expect(result).toContain('doctorId');
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

      expect(result).toContain('procedureId');
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

      // Mensagem deve sugerir cadastrar o paciente em vez de pedir um nome exato.
      expect(result).toContain('não está cadastrado');
      expect(result).toContain('create_patient');
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
            doctorId: 'doctor-1',
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
          doctorId: 'doctor-1',
          patientId: 'pat-1',
          procedureId: 'proc-1',
          hospitalId: 'hosp-1',
          healthPlanId: 'hp-1',
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
        doctorId: 'doctor-2',
      });

      const result = await getTool('confirm_date').execute(
        { surgeryRequestId: 'req-1', selectedDateIndex: 0 },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar selectedDateIndex inválido', async () => {
      const result = await getTool('confirm_date').execute(
        { surgeryRequestId: 'req-1', selectedDateIndex: 9, confirm: true },
        baseContext,
      );

      expect(result).toContain('inválido');
      expect(mockWorkflowService.confirmDate).not.toHaveBeenCalled();
    });

    it('deve executar com sucesso', async () => {
      mockWorkflowService.confirmDate.mockResolvedValue(undefined);

      const result = await getTool('confirm_date').execute(
        { surgeryRequestId: 'req-1', selectedDateIndex: 1, confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'req-1',
        { selectedDateIndex: 1 },
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
          surgeryRequestId: 'SC-0042',
          selectedDateIndex: 0,
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.findOneSimple).toHaveBeenCalledWith({
        protocol: 'SC-0042',
      });
      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'req-1',
        { selectedDateIndex: 0 },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('update_date_options', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('update_date_options').execute(
        { surgeryRequestId: 'req-1', dateOptions: ['2026-05-10'] },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dateOptions inválido', async () => {
      const result = await getTool('update_date_options').execute(
        {
          surgeryRequestId: 'req-1',
          dateOptions: ['data-invalida'],
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
          surgeryRequestId: 'req-1',
          dateOptions: ['2026-05-10', '2026-05-12'],
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.updateDateOptions).toHaveBeenCalledWith(
        'req-1',
        { dateOptions: ['2026-05-10', '2026-05-12'] },
        'user-1',
      );
      expect(result).toContain('✅');
    });
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

  describe('mark_performed', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('mark_performed').execute(
        { surgeryRequestId: 'req-1', surgeryPerformedAt: '2026-05-10' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar surgeryPerformedAt inválida', async () => {
      const result = await getTool('mark_performed').execute(
        {
          surgeryRequestId: 'req-1',
          surgeryPerformedAt: 'invalida',
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
          surgeryRequestId: 'req-1',
          surgeryPerformedAt: '2026-05-15',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.markPerformed).toHaveBeenCalledWith(
        'req-1',
        { surgeryPerformedAt: '2026-05-15' },
        'user-1',
      );
      expect(result).toContain('✅');
    });
  });

  describe('invoice_request', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('invoice_request').execute(
        {
          surgeryRequestId: 'req-1',
          invoiceProtocol: 'INV-1',
          invoiceValue: 100,
          invoiceSentAt: '2026-05-10',
        },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve validar dados inválidos', async () => {
      const result = await getTool('invoice_request').execute(
        {
          surgeryRequestId: 'req-1',
          invoiceProtocol: '',
          invoiceValue: -1,
          invoiceSentAt: 'abc',
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
          surgeryRequestId: 'req-1',
          invoiceProtocol: 'INV-1',
          invoiceValue: 1250.5,
          invoiceSentAt: '2026-05-10',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.invoiceRequest).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          invoiceProtocol: 'INV-1',
          invoiceValue: 1250.5,
          invoiceSentAt: '2026-05-10',
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

  describe('contest_authorization_full', () => {
    it('deve negar acesso sem permissão', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'doctor-2',
      });

      const result = await getTool('contest_authorization_full').execute(
        {
          surgeryRequestId: 'req-1',
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
          surgeryRequestId: 'req-1',
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
          surgeryRequestId: 'req-1',
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
        doctorId: 'doctor-2',
      });

      const result = await getTool('contest_payment').execute(
        {
          surgeryRequestId: 'req-1',
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
          surgeryRequestId: 'req-1',
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
          surgeryRequestId: 'req-1',
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

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('req-1', {
        hospitalId: 'hosp-1',
      });
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

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('req-1', {
        hospitalId: null,
      });
      expect(result).toContain('Hospital removido');
    });
  });

  describe('update_request_admin_data', () => {
    it('deve validar CPF inválido', async () => {
      const result = await getTool('update_request_admin_data').execute(
        {
          surgeryRequestId: 'req-1',
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
        patientId: 'pat-1',
      });

      const result = await getTool('update_request_admin_data').execute(
        {
          surgeryRequestId: 'req-1',
          healthPlanRegistration: 'REG-123',
          patient_phone: '(11) 99999-0000',
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ healthPlanRegistration: 'REG-123' }),
      );
      expect(mockPatientRepo.update).toHaveBeenCalled();
      expect(result).toContain('Dados administrativos atualizados');
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
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
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
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });

    it('update_request_clinical_data deve recusar mutação fora de Pendente', async () => {
      const result = await getTool('update_request_clinical_data').execute(
        {
          surgeryRequestId: 'req-1',
          cidCode: 'M17.0',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });

    it('update_request_admin_data deve recusar mutação fora de Pendente', async () => {
      const result = await getTool('update_request_admin_data').execute(
        {
          surgeryRequestId: 'req-1',
          healthPlanRegistration: 'REG-123',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
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
