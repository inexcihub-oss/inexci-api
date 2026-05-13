import { buildGeneralTools } from './general.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockPatientsService = {
  findOne: jest.fn(),
  findManyWithSearch: jest.fn(),
};

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('GeneralTools — query_patients', () => {
  const tools = buildGeneralTools(mockPatientsService as any);
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  it('lista os pacientes da clínica em claro (nome) mas tokeniza telefone', async () => {
    mockPatientsService.findManyWithSearch.mockResolvedValue([
      { id: 'p1', name: 'Maria do Carmo', phone: '11988887777' },
      { id: 'p2', name: 'José Pereira', phone: '11955554444' },
    ]);

    const piiVault = new PiiVaultService();
    piiVault.startSession('conv-1');

    const tool = getTool('query_patients');
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
    mockPatientsService.findManyWithSearch.mockResolvedValue([]);

    const tool = getTool('query_patients');
    const result = await tool.execute({}, baseContext);

    expect(result).toContain('Nenhum paciente cadastrado');
  });

  it('aplica filtro por search (modo contains, case-insensitive)', async () => {
    mockPatientsService.findManyWithSearch.mockResolvedValue([
      { id: 'p1', name: 'Maria do Carmo', phone: '11988887777' },
    ]);

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: 'maria', match_mode: 'contains' },
      baseContext,
    );

    expect(result).toMatch(/contêm "maria"/);
    expect(result).toContain('Maria do Carmo');
  });

  it('match_mode="fuzzy" tolera typos e nome parcial', async () => {
    mockPatientsService.findManyWithSearch.mockResolvedValue([
      { id: 'p1', name: 'Beatriz Helena Santos', phone: '11988887777' },
      { id: 'p2', name: 'Marcos Antônio', phone: '11955554444' },
    ]);

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: 'Beatriz Elena', match_mode: 'fuzzy' },
      baseContext,
    );

    expect(result).toContain('Beatriz Helena Santos');
    expect(result).not.toContain('Marcos Antônio');
  });

  it('match_mode="prefix" — a tool delega ao service e exibe resultado', async () => {
    mockPatientsService.findManyWithSearch.mockResolvedValue([
      { id: 'p1', name: 'Beatriz Helena Santos', phone: '11988887777' },
    ]);

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: 'B', match_mode: 'prefix' },
      baseContext,
    );

    expect(result).toContain('Beatriz Helena Santos');
    expect(mockPatientsService.findManyWithSearch).toHaveBeenCalledWith(
      'B',
      'prefix',
      expect.any(Number),
      'user-1',
    );
  });

  it('match_mode="exact" quando o service retorna vazio exibe mensagem de não encontrado', async () => {
    mockPatientsService.findManyWithSearch.mockResolvedValue([]);

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: 'Beatriz', match_mode: 'exact' },
      baseContext,
    );

    expect(result).toContain('Nenhum paciente encontrado');
  });

  it('respeita limit (cap em 50)', async () => {
    const fake = Array.from({ length: 80 }, (_, i) => ({
      id: `p${i}`,
      name: `Paciente ${i}`,
      phone: '11999999999',
    }));
    mockPatientsService.findManyWithSearch.mockResolvedValue(fake);

    const tool = getTool('query_patients');
    const result = await tool.execute({ limit: 200 }, baseContext);

    const matches = result.match(/Paciente \d+/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(50);
  });

  it('UUID lookup chama findOne e retorna detalhe completo com PII mascarada', async () => {
    mockPatientsService.findOne.mockResolvedValue({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Carlos Silva',
      cpf: '12345678900',
      phone: '11999990000',
      email: 'carlos@example.com',
      birthDate: '1980-05-10',
    });

    const piiVault = new PiiVaultService();
    piiVault.startSession('conv-1');

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: '123e4567-e89b-12d3-a456-426614174000' },
      { ...baseContext, piiVault },
    );

    expect(mockPatientsService.findOne).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      'user-1',
    );
    expect(result).toContain('Carlos Silva');
    expect(result).not.toContain('12345678900');
    expect(result).not.toContain('11999990000');
    expect(result).toContain('{{cpf_1}}');
    expect(result).toContain('{{phone_1}}');
    expect(result).toContain('{{email_1}}');
    expect(result).toContain('{{birth_date_1}}');
  });

  it('UUID lookup com findOne lançando exceção retorna mensagem de não encontrado', async () => {
    mockPatientsService.findOne.mockRejectedValue(new Error('not found'));

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: '123e4567-e89b-12d3-a456-426614174000' },
      baseContext,
    );

    expect(result).toContain('não encontrado');
  });

  it('fuzzy sem match retorna mensagem de não encontrado sem vazar input', async () => {
    mockPatientsService.findManyWithSearch.mockResolvedValue([]);

    const tool = getTool('query_patients');
    const result = await tool.execute(
      { patient_name_or_id: 'Inexistente', match_mode: 'fuzzy' },
      baseContext,
    );

    expect(result).toContain('Nenhum paciente encontrado');
  });
});
