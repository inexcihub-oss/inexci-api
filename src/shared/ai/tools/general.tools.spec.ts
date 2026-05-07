import { buildGeneralTools } from './general.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockPatientRepo = {
  findOne: jest.fn(),
  findMany: jest.fn(),
};

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('GeneralTools', () => {
  const tools = buildGeneralTools(mockPatientRepo as any);
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('get_patient_info', () => {
    it('retorna dados em texto plano quando não há vault ativo', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Carlos Silva',
          cpf: '12345678900',
          phone: '11999990000',
          email: 'carlos@example.com',
          birth_date: '1980-05-10',
        },
      ]);

      const tool = getTool('get_patient_info');
      const result = await tool.execute(
        { patient_name_or_id: 'Carlos' },
        baseContext,
      );

      expect(result).toContain('Carlos Silva');
      expect(result).toContain('12345678900');
      expect(result).toContain('11999990000');
      expect(result).toContain('carlos@example.com');
    });

    it('com vault ativo, mascara nome, CPF, telefone, e-mail e nascimento', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Carlos Silva',
          cpf: '12345678900',
          phone: '11999990000',
          email: 'carlos@example.com',
          birth_date: '1980-05-10',
        },
      ]);

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('get_patient_info');
      const result = await tool.execute(
        { patient_name_or_id: 'Carlos' },
        { ...baseContext, piiVault },
      );

      expect(result).not.toContain('Carlos Silva');
      expect(result).not.toContain('12345678900');
      expect(result).not.toContain('11999990000');
      expect(result).not.toContain('carlos@example.com');
      expect(result).toContain('{{patient_name_1}}');
      expect(result).toContain('{{cpf_1}}');
      expect(result).toContain('{{phone_1}}');
      expect(result).toContain('{{email_1}}');
      expect(result).toContain('{{birth_date_1}}');

      const detok = piiVault.detokenize('conv-1', result);
      expect(detok).toContain('Carlos Silva');
      expect(detok).toContain('12345678900');
    });

    it('retorna mensagem de "não encontrado" sem vazar input', async () => {
      mockPatientRepo.findMany.mockResolvedValue([]);

      const tool = getTool('get_patient_info');
      const result = await tool.execute(
        { patient_name_or_id: 'Inexistente' },
        baseContext,
      );

      expect(result).toContain('não encontrado');
    });
  });
});
