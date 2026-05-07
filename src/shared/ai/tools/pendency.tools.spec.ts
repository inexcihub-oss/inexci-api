import { buildPendencyTools } from './pendency.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockPendencyValidator = { validateForStatus: jest.fn() };
const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  findMany: jest.fn(),
};

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('PendencyTools', () => {
  const tools = buildPendencyTools(
    mockPendencyValidator as any,
    mockSurgeryRequestRepo as any,
  );
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
          {
            key: 'patient_data',
            name: 'Paciente não vinculado',
            isComplete: false,
            isOptional: false,
            checkItems: [
              { label: 'Nome do paciente', done: false },
              { label: 'CPF', done: true },
            ],
          },
          {
            key: 'tuss_procedures',
            name: 'CID informado',
            isComplete: true,
            isOptional: false,
            checkItems: [],
          },
        ],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Para avançar, faça:');
      expect(result).toContain('Paciente não vinculado');
      expect(result).toContain('Nome do paciente');
      expect(result).toContain('Ação recomendada agora');
      expect(result).toContain('Parâmetros mínimos');
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
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('não tem pendências');
    });

    it('deve negar acesso se doctor_id não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-2',
        doctor_id: 'other-doctor',
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgery_request_id: 'req-2' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve resolver pendências por protocolo SC-XXXX', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.id === 'SC-664980') {
          throw new Error('não deveria consultar SC como UUID');
        }
        if (where?.protocol === 'SC-664980') {
          return {
            id: 'req-77',
            protocol: 'SC-664980',
            doctor_id: 'doctor-1',
          };
        }
        return null;
      });

      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Enviada',
        canAdvance: true,
        pendencies: [],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgery_request_id: 'SC-664980' },
        baseContext,
      );

      expect(mockPendencyValidator.validateForStatus).toHaveBeenCalledWith(
        'req-77',
      );
      expect(result).toContain('SC-664980');
    });

    it('deve aceitar identifier como alias de surgery_request_id', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-8',
        protocol: 'SC-217923',
        doctor_id: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: false,
        pendencies: [
          {
            key: 'patient_data',
            name: 'Dados do Paciente',
            isComplete: false,
            isOptional: false,
            checkItems: [{ label: 'Telefone', done: false }],
          },
        ],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { identifier: 'SC-217923' },
        baseContext,
      );

      expect(mockPendencyValidator.validateForStatus).toHaveBeenCalledWith(
        'req-8',
      );
      expect(result).toContain('Para avançar, faça:');
      expect(result).toContain('Telefone');
    });

    it('com vault ativo, tokeniza o protocolo retornado para a IA', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-vault-1',
        protocol: 'SC-664980',
        status: 1,
        doctor_id: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: false,
        pendencies: [
          {
            key: 'patient_data',
            name: 'Dados do Paciente',
            isComplete: false,
            isOptional: false,
            checkItems: [{ label: 'Telefone', done: false }],
          },
        ],
      });

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');
      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgery_request_id: 'req-vault-1' },
        { ...baseContext, piiVault },
      );

      expect(result).not.toContain('SC-664980');
      expect(result).toContain('{{protocol_1}}');
      expect(piiVault.detokenize('conv-1', result)).toContain('SC-664980');
    });

    it('deve tentar localizar por nome do paciente quando não achar por id/protocolo', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(null);
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        {
          id: 'req-10',
          protocol: 'SC-999001',
          doctor_id: 'doctor-1',
          patient: { name: 'Eduardo Luiz Teixeira' },
        },
      ]);
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Enviada',
        canAdvance: true,
        pendencies: [],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgery_request_id: 'Eduardo Luiz Teixeira' },
        baseContext,
      );

      expect(result).toContain('SC-999001');
    });
  });
});
