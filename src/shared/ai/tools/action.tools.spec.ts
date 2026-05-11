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
const mockPendencyValidator = {
  canAdvance: jest.fn(),
  getSummary: jest.fn().mockResolvedValue({
    canAdvance: false,
    pending: 1,
    total: 1,
    items: [
      {
        key: 'tuss_procedures',
        label: 'Procedimentos TUSS cadastrados',
        blocking: true,
        resolved: false,
        responsibleRole: 'collaborator',
      },
    ],
  }),
};
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
  doctorId: 'doctor-1',
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
    it('para status PENDING (1) bloqueia e direciona para draft send_sc', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('plan_actions');
      expect(result).toContain('send_sc');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
    });

    it('para status PENDING (1) bloqueia mesmo com confirm=true (vai para draft)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', confirm: true },
        baseContext,
      );

      expect(result).toContain('plan_actions');
      expect(result).toContain('send_sc');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
      expect(mockActivityRepo.create).not.toHaveBeenCalled();
    });

    it('deve bloquear se houver pendências (lista resumo)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(false);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', confirm: true },
        baseContext,
      );

      expect(result).toContain('pendências bloqueantes');
      expect(result).toContain('Procedimentos TUSS cadastrados');
    });

    it('deve negar acesso se doctorId não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        doctorId: 'other-doctor',
      });

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve aceitar protocolo numérico (sem prefixo SC-) como identificador', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === 'SC-411701') {
          return {
            ...mockRequest,
            id: 'uuid-xyz',
            protocol: 'SC-411701',
            status: 1,
          };
        }
        return null;
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: '411701', confirm: true },
        baseContext,
      );

      expect(mockPendencyValidator.canAdvance).toHaveBeenCalledWith('uuid-xyz');
      expect(result).toContain('plan_actions');
      expect(result).toContain('send_sc');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
    });

    it('deve aceitar protocolo com prefixo SC- como identificador', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === 'SC-411701') {
          return {
            ...mockRequest,
            id: 'uuid-xyz',
            protocol: 'SC-411701',
            status: 1,
          };
        }
        return null;
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'SC-411701' },
        baseContext,
      );

      expect(result).toContain('SC-411701');
      expect(result).toContain('plan_actions');
      expect(result).toContain('send_sc');
    });

    it('deve retornar erro amigável quando solicitação não for encontrada', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(null);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: '999999', confirm: true },
        baseContext,
      );

      expect(result).toContain('não encontrada');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
    });
    it('deve avançar de Em Agendamento para Agendada (4->5)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 4,
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        ...mockRequest,
        status: 4,
        selectedDateIndex: 1,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);
      mockWorkflowService.confirmDate.mockResolvedValue(undefined);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.confirmDate).toHaveBeenCalledWith(
        'req-1',
        { selectedDateIndex: 1 },
        'user-1',
      );
      expect(result).toContain('Agendada');
    });

    it('para status SCHEDULED (5) bloqueia e direciona para draft mark_performed', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        status: 5,
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        ...mockRequest,
        status: 5,
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', confirm: true },
        baseContext,
      );

      expect(result).toContain('plan_actions');
      expect(result).toContain('mark_performed');
      expect(mockWorkflowService.markPerformed).not.toHaveBeenCalled();
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
        { surgeryRequestId: 'req-1', confirm: true },
        baseContext,
      );

      expect(result).toContain('invoiceProtocol');
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
        billing: { invoiceValue: 1200 },
      });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);
      mockWorkflowService.confirmReceipt.mockResolvedValue(undefined);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', confirm: true },
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
        { surgeryRequestId: 'req-1', hasOpme: true },
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
        { surgeryRequestId: 'req-1', hasOpme: true, confirm: true },
        baseContext,
      );

      expect(mockMutationService.setHasOpme).toHaveBeenCalledWith(
        'req-1',
        true,
        'user-1',
      );
      expect(mockActivityRepo.create).toHaveBeenCalled();
      expect(result).not.toMatch(/[\p{Extended_Pictographic}]/u);
    });
  });

  describe('close_surgery_request', () => {
    it('deve mostrar aviso sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('close_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', reason: 'Paciente desistiu' },
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
          surgeryRequestId: 'req-1',
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
      expect(result).not.toMatch(/[\p{Extended_Pictographic}]/u);
    });
  });

  describe('update_surgery_request_data', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', priority: 4 },
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
        { surgeryRequestId: 'req-1', priority: 3, confirm: true },
        baseContext,
      );

      expect(mockMutationService.updateBasic).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-1', priority: 3 }),
        'user-1',
      );
      expect(mockActivityRepo.create).toHaveBeenCalled();
      expect(result).not.toMatch(/[\p{Extended_Pictographic}]/u);
    });

    it('deve rejeitar prioridade inválida', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', priority: 99, confirm: true },
        baseContext,
      );

      expect(result).toContain('inválida');
    });

    it('deve retornar erro se nenhuma alteração especificada', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);

      const tool = getTool('update_surgery_request_data');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Nenhuma alteração');
    });
  });

  describe('update_patient_data', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        ...mockRequest,
        patientId: 'pat-1',
      });

      const tool = getTool('update_patient_data');
      const result = await tool.execute(
        { surgeryRequestId: 'SC-0042', phone: '(11) 99999-9999' },
        baseContext,
      );

      expect(result).toContain('Confirme');
      expect(mockPatientRepo.update).not.toHaveBeenCalled();
    });

    it('deve atualizar dados do paciente com confirm=true', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === 'SC-0042') {
          return { ...mockRequest, patientId: 'pat-1' };
        }
        return null;
      });
      mockPatientRepo.update.mockResolvedValue({ id: 'pat-1' });

      const tool = getTool('update_patient_data');
      const result = await tool.execute(
        {
          surgeryRequestId: 'SC-0042',
          phone: '(11) 99999-9999',
          zipCode: '01310-100',
          confirm: true,
        },
        baseContext,
      );

      expect(mockPatientRepo.update).toHaveBeenCalledWith('pat-1', {
        phone: '(11) 99999-9999',
        zipCode: '01310-100',
      });
      expect(result).toContain('atualizados com sucesso');
    });
  });
});
