import { buildActionTools } from './action.tools';
import { ToolContext } from './tool.interface';

const mockSurgeryRequestRepo = { findOneSimple: jest.fn(), findOne: jest.fn() };
const mockWorkflowService = {
  sendRequest: jest.fn(),
  startAnalysis: jest.fn(),
  acceptAuthorization: jest.fn(),
  confirmDate: jest.fn(),
  markPerformed: jest.fn(),
  invoiceRequest: jest.fn(),
  confirmReceipt: jest.fn(),
  closeSurgeryRequest: jest.fn(),
};
const mockMutationService = {
  setHasOpme: jest.fn(),
  updateBasic: jest.fn(),
};
const mockPendencyValidator = { canAdvance: jest.fn() };
const mockActivityRepo = { create: jest.fn() };
const mockPatientRepo = { update: jest.fn() };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

const mockRequest = {
  id: 'req-1',
  protocol: 'SC-0042',
  status: 1,
  doctor_id: 'doctor-1',
};

describe('ActionTools', () => {
  const tools = buildActionTools(
    mockSurgeryRequestRepo as any,
    mockWorkflowService as any,
    mockMutationService as any,
    mockPendencyValidator as any,
    mockActivityRepo as any,
    mockPatientRepo as any,
  );

  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('advance_surgery_request', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Pendente');
      expect(result).toContain('Enviada');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
    });
    it('deve avançar de Pendente para Enviada com confirm=true', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);
      mockWorkflowService.sendRequest.mockResolvedValue(undefined);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.sendRequest).toHaveBeenCalled();
      expect(mockActivityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system' }),
      );
      expect(result).toContain('com sucesso');
    });

    it('deve bloquear se houver pendências', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(false);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', confirm: true },
        baseContext,
      );

      expect(result).toContain('pendências bloqueantes');
    });

    it('deve negar acesso se doctor_id não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctor_id: 'other-doctor',
      });

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });
    it('deve avançar de Em Agendamento para Agendada (4->5)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 4,
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        ...mockRequest,
        status: 4,
        selected_date_index: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);
      mockWorkflowService.confirmDate.mockResolvedValue(undefined);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'req-1',
        { selected_date_index: 1 },
        'user-1',
      );
      expect(result).toContain('Agendada');
    });

    it('deve avançar de Agendada para Realizada (5->6)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 5,
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        ...mockRequest,
        status: 5,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);
      mockWorkflowService.markPerformed.mockResolvedValue(undefined);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.markPerformed).toHaveBeenCalled();
      expect(result).toContain('Realizada');
    });

    it('deve exigir dados no avanço 6->7 quando faltarem', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 6,
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        ...mockRequest,
        status: 6,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', confirm: true },
        baseContext,
      );

      expect(result).toContain('invoice_protocol');
      expect(mockWorkflowService.invoiceRequest).not.toHaveBeenCalled();
    });

    it('deve avançar de Faturada para Finalizada (7->8)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 7,
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        ...mockRequest,
        status: 7,
        billing: { invoice_value: 1200 },
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);
      mockWorkflowService.confirmReceipt.mockResolvedValue(undefined);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.confirmReceipt).toHaveBeenCalled();
      expect(result).toContain('Finalizada');
    });
  });

  describe('set_has_opme', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('set_has_opme');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', has_opme: true },
        baseContext,
      );

      expect(result).toContain('Confirme');
      expect(mockMutationService.setHasOpme).not.toHaveBeenCalled();
    });

    it('deve definir OPME com confirm=true e logar atividade', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
      mockMutationService.setHasOpme.mockResolvedValue(undefined);

      const tool = getTool('set_has_opme');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', has_opme: true, confirm: true },
        baseContext,
      );

      expect(mockMutationService.setHasOpme).toHaveBeenCalledWith(
        'req-1',
        true,
        'user-1',
      );
      expect(mockActivityRepo.create).toHaveBeenCalled();
      expect(result).toContain('✅');
    });
  });

  describe('close_surgery_request', () => {
    it('deve mostrar aviso sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('close_surgery_request');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', reason: 'Paciente desistiu' },
        baseContext,
      );

      expect(result).toContain('não pode ser desfeita');
      expect(mockWorkflowService.closeSurgeryRequest).not.toHaveBeenCalled();
    });

    it('deve encerrar com confirm=true e logar atividade', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
      mockWorkflowService.closeSurgeryRequest.mockResolvedValue(undefined);

      const tool = getTool('close_surgery_request');
      const result = await tool.execute(
        {
          surgery_request_id: 'req-1',
          reason: 'Paciente desistiu',
          confirm: true,
        },
        baseContext,
      );

      expect(mockWorkflowService.closeSurgeryRequest).toHaveBeenCalled();
      expect(mockActivityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Paciente desistiu'),
        }),
      );
      expect(result).toContain('✅');
    });
  });

  describe('update_surgery_request_data', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', priority: 4 },
        baseContext,
      );

      expect(result).toContain('Urgente');
      expect(result).toContain('Confirme');
      expect(mockMutationService.updateBasic).not.toHaveBeenCalled();
    });

    it('deve atualizar com confirm=true e logar atividade', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
      mockMutationService.updateBasic.mockResolvedValue(undefined);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', priority: 3, confirm: true },
        baseContext,
      );

      expect(mockMutationService.updateBasic).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-1', priority: 3 }),
        'user-1',
      );
      expect(mockActivityRepo.create).toHaveBeenCalled();
      expect(result).toContain('✅');
    });

    it('deve rejeitar prioridade inválida', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgery_request_id: 'req-1', priority: 99, confirm: true },
        baseContext,
      );

      expect(result).toContain('inválida');
    });

    it('deve retornar erro se nenhuma alteração especificada', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Nenhuma alteração');
    });
  });

  describe('update_patient_data', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        patient_id: 'pat-1',
      });

      const tool = getTool('update_patient_data');
      const result = await tool.execute(
        { surgery_request_id: 'SC-0042', phone: '(11) 99999-9999' },
        baseContext,
      );

      expect(result).toContain('Confirme');
      expect(mockPatientRepo.update).not.toHaveBeenCalled();
    });

    it('deve atualizar dados do paciente com confirm=true', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === 'SC-0042') {
          return { ...mockRequest, patient_id: 'pat-1' };
        }
        return null;
      });
      mockPatientRepo.update.mockResolvedValue({ id: 'pat-1' });

      const tool = getTool('update_patient_data');
      const result = await tool.execute(
        {
          surgery_request_id: 'SC-0042',
          phone: '(11) 99999-9999',
          zip_code: '01310-100',
          confirm: true,
        },
        baseContext,
      );

      expect(mockPatientRepo.update).toHaveBeenCalledWith('pat-1', {
        phone: '(11) 99999-9999',
        zip_code: '01310-100',
      });
      expect(result).toContain('atualizados com sucesso');
    });
  });
});
