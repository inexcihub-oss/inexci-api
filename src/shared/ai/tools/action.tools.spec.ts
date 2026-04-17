import { buildActionTools } from './action.tools';
import { ToolContext } from './tool.interface';

const mockSurgeryRequestRepo = { findOneSimple: jest.fn() };
const mockWorkflowService = {
  sendRequest: jest.fn(),
  startAnalysis: jest.fn(),
  acceptAuthorization: jest.fn(),
  closeSurgeryRequest: jest.fn(),
};
const mockMutationService = {
  setHasOpme: jest.fn(),
  updateBasic: jest.fn(),
};
const mockPendencyValidator = { canAdvance: jest.fn() };
const mockActivityRepo = { create: jest.fn() };

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
  );

  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('advance_surgery_request', () => {
    it('deve mostrar preview sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({ ...mockRequest, status: 1 });
      mockPendencyValidator.canAdvance.mockResolvedValue(true);

      const tool = getTool('advance_surgery_request');
      const result = await tool.execute({ surgery_request_id: 'req-1' }, baseContext);

      expect(result).toContain('Pendente');
      expect(result).toContain('Enviada');
      expect(mockWorkflowService.sendRequest).not.toHaveBeenCalled();
    });

    it('deve avançar de Pendente para Enviada com confirm=true', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({ ...mockRequest, status: 1 });
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
      expect(result).toContain('✅');
    });

    it('deve bloquear se houver pendências', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({ ...mockRequest, status: 1 });
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
      const result = await tool.execute({ surgery_request_id: 'req-1' }, baseContext);

      expect(result).toContain('permissão');
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

      expect(mockMutationService.setHasOpme).toHaveBeenCalledWith('req-1', true, 'user-1');
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
        { surgery_request_id: 'req-1', reason: 'Paciente desistiu', confirm: true },
        baseContext,
      );

      expect(mockWorkflowService.closeSurgeryRequest).toHaveBeenCalled();
      expect(mockActivityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Paciente desistiu') }),
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
      const result = await tool.execute({ surgery_request_id: 'req-1' }, baseContext);

      expect(result).toContain('Nenhuma alteração');
    });
  });
});
