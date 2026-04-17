import { buildPendencyTools } from './pendency.tools';
import { ToolContext } from './tool.interface';

const mockPendencyValidator = { validateForStatus: jest.fn() };
const mockSurgeryRequestRepo = { findOneSimple: jest.fn() };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('PendencyTools', () => {
  const tools = buildPendencyTools(mockPendencyValidator as any, mockSurgeryRequestRepo as any);
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('get_pendencies', () => {
    it('deve listar pendências bloqueantes e concluídas', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        doctor_id: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: false,
        pendencies: [
          { name: 'Paciente não vinculado', isComplete: false, isOptional: false },
          { name: 'CID informado', isComplete: true, isOptional: false },
        ],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute({ surgery_request_id: 'req-1' }, baseContext);

      expect(result).toContain('Paciente não vinculado');
      expect(result).toContain('CID informado');
    });

    it('deve retornar mensagem positiva se sem pendências', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0001',
        status: 1,
        doctor_id: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: true,
        pendencies: [],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute({ surgery_request_id: 'req-1' }, baseContext);

      expect(result).toContain('não tem pendências');
    });

    it('deve negar acesso se doctor_id não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-2',
        doctor_id: 'other-doctor',
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute({ surgery_request_id: 'req-2' }, baseContext);

      expect(result).toContain('permissão');
    });
  });
});
