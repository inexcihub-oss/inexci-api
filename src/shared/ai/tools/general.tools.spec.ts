import { buildGeneralTools } from './general.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockPatientRepo = {
  findOne: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
};

const mockUserRepo = {
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
  const tools = buildGeneralTools(mockPatientRepo as any, mockUserRepo as any);
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('get_patient_info', () => {
    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-1',
        name: 'Admin',
        ownerId: 'owner-1',
      });
    });

    it('retorna dados em texto plano quando não há vault ativo', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Carlos Silva',
          cpf: '12345678900',
          phone: '11999990000',
          email: 'carlos@example.com',
          birthDate: '1980-05-10',
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

    it('com vault ativo, mascara CPF, telefone, e-mail e nascimento mas mantém nome em claro (PII de negócio do próprio owner)', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        {
          id: 'pat-1',
          name: 'Carlos Silva',
          cpf: '12345678900',
          phone: '11999990000',
          email: 'carlos@example.com',
          birthDate: '1980-05-10',
        },
      ]);

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('get_patient_info');
      const result = await tool.execute(
        { patient_name_or_id: 'Carlos' },
        { ...baseContext, piiVault },
      );

      expect(result).toContain('Carlos Silva');
      expect(result).not.toContain('12345678900');
      expect(result).not.toContain('11999990000');
      expect(result).not.toContain('carlos@example.com');
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

  describe('list_patients', () => {
    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-1',
        name: 'Admin',
        ownerId: 'owner-1',
      });
    });

    it('lista os pacientes da clínica em claro (nome) mas tokeniza telefone', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        { id: 'p1', name: 'Maria do Carmo', phone: '11988887777' },
        { id: 'p2', name: 'José Pereira', phone: '11955554444' },
      ]);

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('list_patients');
      const result = await tool.execute({}, { ...baseContext, piiVault });

      expect(result).toContain('Pacientes cadastrados');
      expect(result).toContain('Maria do Carmo');
      expect(result).toContain('José Pereira');
      expect(result).toContain('{{phone_1}}');
      expect(result).toContain('{{phone_2}}');
      expect(result).not.toContain('11988887777');
      expect(result).not.toContain('11955554444');
    });

    it('retorna mensagem clara quando não há pacientes', async () => {
      mockPatientRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_patients');
      const result = await tool.execute({}, baseContext);

      expect(result).toContain('Nenhum paciente cadastrado');
    });

    it('aplica filtro por search (modo `contains`, case-insensitive)', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        { id: 'p1', name: 'Maria do Carmo', phone: '11988887777' },
        { id: 'p2', name: 'José Pereira', phone: '11955554444' },
      ]);

      const tool = getTool('list_patients');
      const result = await tool.execute(
        { search: 'maria', match_mode: 'contains' },
        baseContext,
      );

      expect(result).toMatch(/contêm "maria"/);
      expect(result).toContain('Maria do Carmo');
      expect(result).not.toContain('José Pereira');
    });

    it('match_mode="fuzzy" tolera typos e nome parcial', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        { id: 'p1', name: 'Beatriz Helena Santos', phone: '11988887777' },
        { id: 'p2', name: 'Marcos Antônio', phone: '11955554444' },
      ]);

      const tool = getTool('list_patients');
      const result = await tool.execute(
        { search: 'Beatriz Elena', match_mode: 'fuzzy' },
        baseContext,
      );

      expect(result).toContain('Beatriz Helena Santos');
      expect(result).not.toContain('Marcos Antônio');
    });

    it('match_mode="prefix" filtra apenas quem começa com o termo (regressão "começa com B")', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        { id: 'p1', name: 'Beatriz Helena Santos', phone: '11988887777' },
        { id: 'p2', name: 'Marcos Antônio Ribeiro', phone: '11955554444' },
      ]);

      const tool = getTool('list_patients');
      const result = await tool.execute(
        { search: 'B', match_mode: 'prefix' },
        baseContext,
      );

      expect(result).toContain('Beatriz Helena Santos');
      // "Ribeiro" contém "b" mas o nome NÃO começa com B → não pode vazar.
      expect(result).not.toContain('Marcos Antônio Ribeiro');
    });

    it('match_mode="exact" exige nome integral', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        { id: 'p1', name: 'Beatriz Helena Santos', phone: '11988887777' },
        { id: 'p2', name: 'Carlos Andrade', phone: '11955554444' },
      ]);

      const tool = getTool('list_patients');
      const result = await tool.execute(
        { search: 'Beatriz', match_mode: 'exact' },
        baseContext,
      );

      expect(result).toContain('Nenhum paciente encontrado');
      expect(result).not.toContain('Beatriz Helena Santos');
    });

    it('respeita limit (cap em 50)', async () => {
      const fake = Array.from({ length: 80 }, (_, i) => ({
        id: `p${i}`,
        name: `Paciente ${i}`,
        phone: '11999999999',
      }));
      mockPatientRepo.findMany.mockResolvedValue(fake);

      const tool = getTool('list_patients');
      const result = await tool.execute({ limit: 200 }, baseContext);

      // Apenas até 50 nomes devem aparecer.
      const matches = result.match(/Paciente \d+/g) ?? [];
      expect(matches.length).toBeLessThanOrEqual(50);
    });
  });

  describe('create_patient', () => {
    const VALID_CPF = '11144477735';

    beforeEach(() => {
      mockUserRepo.findOne.mockImplementation(async ({ id }: any) => {
        if (id === 'user-1') {
          return { id: 'user-1', name: 'Admin', ownerId: 'owner-1' };
        }
        if (id === 'doctor-1') {
          return { id: 'doctor-1', name: 'Dr. House', ownerId: 'owner-1' };
        }
        return null;
      });
      mockPatientRepo.findMany.mockResolvedValue([]);
    });

    it('rejeita quando falta o nome', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        { phone: '11999990000', email: 'a@b.com' },
        baseContext,
      );
      expect(result).toContain('`name`');
    });

    it('rejeita quando telefone não foi informado', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        { name: 'Carlos', email: 'carlos@example.com' },
        baseContext,
      );
      expect(result).toContain('`phone`');
    });

    it('rejeita telefone com formato inválido', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        { name: 'Carlos', phone: '123', email: 'carlos@example.com' },
        baseContext,
      );
      expect(result).toContain('`phone`');
    });

    it('rejeita quando email não foi informado', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        { name: 'Carlos', phone: '11999990000' },
        baseContext,
      );
      expect(result).toContain('`email`');
    });

    it('rejeita email com formato inválido', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos',
          phone: '11999990000',
          email: 'sem-arroba',
        },
        baseContext,
      );
      expect(result).toContain('`email`');
    });

    it('rejeita CPF inválido (DV errado)', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos',
          phone: '11999990000',
          email: 'carlos@example.com',
          cpf: '12345678900',
        },
        baseContext,
      );
      expect(result).toContain('`cpf`');
    });

    it('rejeita data de nascimento futura', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos',
          phone: '11999990000',
          email: 'carlos@example.com',
          birth_date: '3000-01-01',
        },
        baseContext,
      );
      expect(result).toContain('`birth_date`');
    });

    it('mostra preview quando confirm=false', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos Silva',
          phone: '11999990000',
          email: 'carlos@example.com',
          cpf: VALID_CPF,
          birth_date: '1980-05-10',
        },
        baseContext,
      );
      expect(result).toContain('Confirme');
      expect(mockPatientRepo.create).not.toHaveBeenCalled();
    });

    it('cria paciente com cadastro mínimo (nome, telefone e email) e cita pendência aberta para CPF/nascimento', async () => {
      mockPatientRepo.create.mockResolvedValue({
        id: 'pat-min',
        name: 'José Ferreira',
        phone: '11999990000',
        email: 'jose@example.com',
        cpf: null,
      });

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'José Ferreira',
          phone: '11999990000',
          email: 'jose@example.com',
          confirm: true,
        },
        { ...baseContext, piiVault },
      );

      expect(mockPatientRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'doctor-1',
          ownerId: 'owner-1',
          name: 'José Ferreira',
          phone: '11999990000',
          email: 'jose@example.com',
          cpf: null,
          birthDate: null,
          active: true,
        }),
      );
      expect(result).toContain('cadastrado com sucesso');
      expect(result).toContain('Dados do Paciente');
      expect(result).toContain('CPF');
      expect(result).toContain('data de nascimento');
      expect(result).not.toMatch(/faltam[^\n]*telefone/i);
    });

    it('preview com cadastro mínimo (nome, telefone e email) avisa sobre pendência futura', async () => {
      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'José Ferreira',
          phone: '11999990000',
          email: 'jose@example.com',
        },
        baseContext,
      );
      expect(result).toContain('Confirme');
      expect(result).toContain('Dados do Paciente');
      expect(result).toContain('CPF');
      expect(result).toContain('data de nascimento');
      expect(mockPatientRepo.create).not.toHaveBeenCalled();
    });

    it('cria paciente quando confirm=true e tokeniza retorno', async () => {
      mockPatientRepo.create.mockResolvedValue({
        id: 'pat-1',
        name: 'Carlos Silva',
        phone: '11999990000',
        email: 'carlos@example.com',
        cpf: VALID_CPF,
      });

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos Silva',
          phone: '(11) 99999-0000',
          email: 'carlos@example.com',
          cpf: VALID_CPF,
          birth_date: '1980-05-10',
          confirm: true,
        },
        { ...baseContext, piiVault },
      );

      expect(mockPatientRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'doctor-1',
          ownerId: 'owner-1',
          name: 'Carlos Silva',
          phone: '11999990000',
          email: 'carlos@example.com',
          cpf: VALID_CPF,
          active: true,
        }),
      );
      expect(result).toContain('{{patient_name_1}}');
      expect(result).not.toContain('Carlos Silva');
      expect(result).not.toContain(VALID_CPF);
    });

    it('detokeniza placeholders nos argumentos antes de validar/criar', async () => {
      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');
      const namePlaceholder = piiVault.tokenize(
        'conv-1',
        'José Ferreira',
        'patient_name',
      );
      const phonePlaceholder = piiVault.tokenize(
        'conv-1',
        '11912345678',
        'phone',
      );
      const cpfPlaceholder = piiVault.tokenize('conv-1', VALID_CPF, 'cpf');

      mockPatientRepo.create.mockResolvedValue({
        id: 'pat-1',
        name: 'José Ferreira',
        phone: '11912345678',
        email: 'jose@example.com',
        cpf: VALID_CPF,
      });

      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: namePlaceholder,
          phone: phonePlaceholder,
          email: 'jose@example.com',
          cpf: cpfPlaceholder,
          confirm: true,
        },
        { ...baseContext, piiVault },
      );

      expect(mockPatientRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'José Ferreira',
          phone: '11912345678',
          cpf: VALID_CPF,
        }),
      );
      expect(result).toContain('{{patient_name_');
    });

    it('exige doctor_name_or_id quando há múltiplos médicos acessíveis', async () => {
      mockUserRepo.findMany.mockResolvedValue([
        { id: 'doctor-1', name: 'Dr. House' },
        { id: 'doctor-2', name: 'Dra. Cuddy' },
      ]);

      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos',
          phone: '11999990000',
          email: 'carlos@example.com',
          confirm: true,
        },
        { ...baseContext, accessibleDoctorIds: ['doctor-1', 'doctor-2'] },
      );

      expect(result).toContain('doctor_name_or_id');
      expect(mockPatientRepo.create).not.toHaveBeenCalled();
    });

    it('bloqueia criação quando CPF já existe na clínica', async () => {
      mockPatientRepo.findMany.mockResolvedValue([
        { id: 'pat-existing', name: 'Outro Paciente', cpf: VALID_CPF },
      ]);

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');

      const tool = getTool('create_patient');
      const result = await tool.execute(
        {
          name: 'Carlos',
          phone: '11999990000',
          email: 'carlos@example.com',
          cpf: VALID_CPF,
          confirm: true,
        },
        { ...baseContext, piiVault },
      );

      expect(result).toContain('Já existe paciente');
      expect(mockPatientRepo.create).not.toHaveBeenCalled();
    });
  });
});
