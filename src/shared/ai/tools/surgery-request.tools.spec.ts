import { buildSurgeryRequestTools } from './surgery-request.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  findOne: jest.fn(),
  findMany: jest.fn(),
};

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('SurgeryRequestTools', () => {
  const tools = buildSurgeryRequestTools(mockSurgeryRequestRepo as any);
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('get_surgery_request_status', () => {
    it('deve buscar por protocolo e retornar status formatado', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        priority: 2,
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        hospitalId: null,
        healthPlanId: null,
        dateCall: null,
        patient: { name: 'João Silva' },
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-0042' }, baseContext);

      expect(result).toContain('SC-0042');
      expect(result).toContain('Pendente');
      expect(result).toContain('João Silva');
    });

    it('deve retornar erro se solicitação não encontrada', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(null);
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-9999' }, baseContext);

      expect(result).toContain('Não encontrei');
    });

    it('deve buscar por protocolo mesmo com pontuação no final', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-664980',
        status: 3,
        priority: 2,
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        hospitalId: null,
        healthPlanId: null,
        dateCall: null,
        patient: { name: 'Carlos' },
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute(
        { identifier: 'SC-664980?' },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.findOneSimple).toHaveBeenCalledWith({
        protocol: 'SC-664980',
      });
      expect(result).toContain('SC-664980');
    });

    it('deve buscar por protocolo numérico sem prefixo SC', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(
        async (where: any) => {
          if (where?.protocol === '664980') {
            return {
              id: 'req-1',
              protocol: '664980',
              status: 3,
              priority: 2,
              doctorId: 'doctor-1',
              patientId: 'pat-1',
              hospitalId: null,
              healthPlanId: null,
              dateCall: null,
              patient: { name: 'Carlos' },
            };
          }
          return null;
        },
      );

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: '664980' }, baseContext);

      expect(result).toContain('Solicitação SC-664980');
    });

    it('deve negar acesso se doctorId não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-2',
        protocol: 'SC-0001',
        doctorId: 'other-doctor',
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-0001' }, baseContext);

      expect(result).toContain('permissão');
    });

    it('deve retornar nomes e ações de pendências quando dados completos existirem', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-99',
        protocol: 'SC-664980',
        doctorId: 'doctor-1',
      });

      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        id: 'req-99',
        protocol: 'SC-664980',
        status: 2,
        priority: 1,
        doctorId: 'doctor-1',
        surgeryDate: new Date('2026-06-15T00:00:00.000Z'),
        patientId: 'pat-1',
        hospitalId: 'hos-1',
        healthPlanId: 'hp-1',
        patient: { name: 'Carlos Mendonça' },
        hospital: { name: 'Hospital Santa Helena' },
        healthPlan: { name: 'Unimed' },
      });

      const pendencyValidatorMock = {
        validateForStatus: jest.fn().mockResolvedValue({
          pendencies: [
            {
              name: 'Dados do Paciente',
              isComplete: false,
              isOptional: false,
              checkItems: [
                { label: 'Telefone', done: false },
                { label: 'CPF', done: true },
              ],
            },
          ],
        }),
      };

      const toolsWithPendency = buildSurgeryRequestTools(
        mockSurgeryRequestRepo as any,
        pendencyValidatorMock as any,
      );
      const tool = toolsWithPendency.find(
        (t) => t.name === 'get_surgery_request_status',
      )!;
      const result = await tool.execute(
        { identifier: 'SC-664980' },
        baseContext,
      );

      expect(result).toContain('Carlos Mendonça');
      expect(result).toContain('Hospital Santa Helena');
      expect(result).toContain('Unimed');
      expect(result).toContain('Para avançar de etapa, faça:');
      expect(result).toContain('Dados do Paciente');
      expect(result).toContain('Telefone');
    });

    it('deve retornar erro se userId for null', async () => {
      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute(
        { identifier: 'SC-0001' },
        { ...baseContext, userId: null },
      );
      expect(result).toContain('cadastrado');
    });

    it('com vault ativo, retorna placeholders em vez de nomes reais', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        priority: 2,
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        patient: { name: 'João Silva' },
        hospital: { name: 'Hospital Santa Maria' },
        healthPlan: { name: 'Unimed' },
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue(null);

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');
      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute(
        { identifier: 'SC-0042' },
        { ...baseContext, piiVault },
      );

      expect(result).not.toContain('João Silva');
      expect(result).not.toContain('Hospital Santa Maria');
      expect(result).not.toContain('Unimed');
      expect(result).toContain('{{patient_name_1}}');
      expect(result).toContain('{{hospital_name_1}}');
      expect(result).toContain('{{health_plan_name_1}}');

      expect(piiVault.detokenize('conv-1', result)).toContain('João Silva');
    });
  });

  describe('list_surgery_requests', () => {
    it('deve listar solicitações formatadas', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        { protocol: '0001', status: 1, patient: { name: 'Maria' } },
        { protocol: 'SC-0002', status: 3, patient: { name: 'José' } },
      ]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      expect(result).toContain('SC-0001');
      expect(result).toContain('SC-0002');
      expect(result).toContain('Maria');
    });

    it('deve agrupar e ordenar a lista por status (Pendente → Encerrada)', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        { protocol: '0050', status: 5, patient: { name: 'Carlos' } },
        { protocol: '0001', status: 1, patient: { name: 'Maria' } },
        { protocol: '0010', status: 3, patient: { name: 'João' } },
        { protocol: '0011', status: 3, patient: { name: 'Lucas' } },
      ]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      expect(result).toContain('por status');
      const indexPendente = result.indexOf('Pendente');
      const indexAnalise = result.indexOf('Em Análise');
      const indexAgendada = result.indexOf('Agendada');

      expect(indexPendente).toBeGreaterThan(-1);
      expect(indexAnalise).toBeGreaterThan(indexPendente);
      expect(indexAgendada).toBeGreaterThan(indexAnalise);

      // Os dois itens "Em Análise" devem estar agrupados (sem outro status entre eles)
      const segmentoAnalise = result.slice(
        indexAnalise,
        indexAgendada > indexAnalise ? indexAgendada : result.length,
      );
      expect(segmentoAnalise).toContain('SC-0010');
      expect(segmentoAnalise).toContain('SC-0011');
    });

    it('deve retornar mensagem quando não há solicitações', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      expect(result).toContain('Nenhuma');
    });

    it('deve limitar a 200 resultados no máximo (clamp do limit alto)', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_surgery_requests');
      await tool.execute({ limit: 5000 }, baseContext);

      expect(mockSurgeryRequestRepo.findMany).toHaveBeenCalledWith(
        expect.anything(),
        0,
        200,
      );
    });

    it('deve usar 50 como limit padrão quando o usuário não informa', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_surgery_requests');
      await tool.execute({}, baseContext);

      expect(mockSurgeryRequestRepo.findMany).toHaveBeenCalledWith(
        expect.anything(),
        0,
        50,
      );
    });

    // Regressão: print 2026-05-11 — colaborador com acesso a múltiplos médicos
    // só via SCs do primeiro doctorId porque a tool fazia
    // `where.doctorId = accessibleDoctorIds[0]` em vez de `In(...)`. Faltavam
    // SCs e a IA via uma lista incompleta.
    it('lista SCs de TODOS os médicos acessíveis ao usuário (não só do primeiro)', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_surgery_requests');
      await tool.execute(
        {},
        { ...baseContext, accessibleDoctorIds: ['doctor-1', 'doctor-2'] },
      );

      const callArgs = mockSurgeryRequestRepo.findMany.mock.calls[0];
      const where = callArgs[0];
      // O TypeORM In(...) cria um objeto com `_type: 'in'` e `_value: [...]`.
      const doctorIdValue = where?.doctorId;
      const inValues =
        doctorIdValue?._value || doctorIdValue?.value || doctorIdValue;
      expect(Array.isArray(inValues) ? inValues : []).toEqual(
        expect.arrayContaining(['doctor-1', 'doctor-2']),
      );
    });

    it('respeita a ordem canônica do workflow mesmo quando a query devolve embaralhado', async () => {
      // Devolve totalmente fora de ordem, com status 9, 5, 1, 7, 3 misturados.
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        { protocol: '0099', status: 9, patient: { name: 'Z' } },
        { protocol: '0050', status: 5, patient: { name: 'C' } },
        { protocol: '0001', status: 1, patient: { name: 'M' } },
        { protocol: '0070', status: 7, patient: { name: 'F' } },
        { protocol: '0030', status: 3, patient: { name: 'J' } },
      ]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      const order = [
        'Pendente',
        'Em Análise',
        'Agendada',
        'Faturada',
        'Encerrada',
      ].map((label) => result.indexOf(label));
      // Todos presentes
      expect(order.every((i) => i > -1)).toBe(true);
      // Estritamente crescente — confirma a ordem do workflow
      for (let i = 1; i < order.length; i++) {
        expect(order[i]).toBeGreaterThan(order[i - 1]);
      }
    });
  });

  describe('get_surgery_request_status (campos enriquecidos)', () => {
    it('deve incluir CID, matrícula e plano quando preenchidos', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        doctorId: 'doctor-1',
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        priority: 2,
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        patient: { name: 'João' },
        cidCode: 'M75.1',
        healthPlanRegistration: 'REG-1234',
        healthPlanType: 'Apartamento',
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-0042' }, baseContext);

      expect(result).toContain('CID: M75.1');
      expect(result).toContain('Matrícula: REG-1234');
      expect(result).toContain('Plano/Apartamento: Apartamento');
    });

    it('deve mostrar "Não informado/a" quando CID, matrícula e plano estão vazios', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        doctorId: 'doctor-1',
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        priority: 2,
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        patient: { name: 'João' },
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-0042' }, baseContext);

      expect(result).toContain('CID: Não informado');
      expect(result).toContain('Matrícula: Não informada');
      expect(result).toContain('Plano/Apartamento: Não informado');
    });

    it('NÃO deve incluir o emoji de prancheta no cabeçalho', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        doctorId: 'doctor-1',
      });
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        priority: 2,
        doctorId: 'doctor-1',
        patientId: 'pat-1',
        patient: { name: 'João' },
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-0042' }, baseContext);

      expect(result).not.toContain('📋');
    });
  });

  describe('list_surgery_requests (sem emoji)', () => {
    it('NÃO deve incluir emoji de prancheta no cabeçalho', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        { protocol: '0001', status: 1, patient: { name: 'Maria' } },
      ]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      expect(result).not.toContain('📋');
    });
  });

  describe('list_surgery_requests (sem numeração nem bullet)', () => {
    it('NÃO deve numerar nem usar bullet — usar SC-XXXX direto', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        { protocol: '0001', status: 1, patient: { name: 'Maria' } },
        { protocol: '0002', status: 1, patient: { name: 'José' } },
      ]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      // Não deve aparecer prefixo de bullet ou numeração antes do "SC-"
      expect(result).not.toMatch(/•\s*SC-/);
      expect(result).not.toMatch(/^\s*1\s*[-.)]\s*SC-/m);
      expect(result).not.toMatch(/^\s*2\s*[-.)]\s*SC-/m);
      // E o item deve aparecer começando direto com "SC-"
      expect(result).toMatch(/SC-0001\s—\sMaria/);
      expect(result).toMatch(/SC-0002\s—\sJosé/);
    });
  });
});
