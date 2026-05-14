import { buildActionTools } from './action.tools';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

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

  // Regressão Sub-fase 3.8 (PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA):
  // `update_surgery_request_data` e `update_patient_data` foram removidas.
  it('não expõe mais update_surgery_request_data nem update_patient_data', () => {
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('update_surgery_request_data');
    expect(names).not.toContain('update_patient_data');
  });

  // ----------------------------------------------------------------
  // Fase 2 PLANO-CORRECOES-CODE-REVIEW-2026-05-13: envelope ToolResult
  // ----------------------------------------------------------------
  describe('envelope ToolResult — close_surgery_request', () => {
    it('status=pending_confirmation quando sem confirm', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(mockRequest);
      const tool = getTool('close_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', reason: 'Paciente desistiu' },
        baseContext,
      );
      const parsed = parseToolResult(result);
      expect(parsed?.status).toBe('pending_confirmation');
      expect(parsed?.pending_confirmation?.tool).toBe('close_surgery_request');
      expect(parsed?.message).toContain('não pode ser desfeita');
    });

    it('status=ok após encerramento com confirm', async () => {
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
      const parsed = parseToolResult(result);
      expect(parsed?.status).toBe('ok');
      expect(parsed?.affected?.[0]?.kind).toBe('surgery_request');
    });

    it('status=blocked quando sem userId (acesso negado)', async () => {
      const tool = getTool('close_surgery_request');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1', reason: 'teste' },
        { ...baseContext, userId: null },
      );
      expect(parseToolResult(result)?.status).toBe('blocked');
    });
  });
});
