import { buildSurgeryRequestTools } from './surgery-request.tools';
import { ToolContext } from './tool.interface';

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
        doctor_id: 'doctor-1',
        patient_id: 'pat-1',
        hospital_id: null,
        health_plan_id: null,
        date_call: null,
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
        doctor_id: 'doctor-1',
        patient_id: 'pat-1',
        hospital_id: null,
        health_plan_id: null,
        date_call: null,
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
              doctor_id: 'doctor-1',
              patient_id: 'pat-1',
              hospital_id: null,
              health_plan_id: null,
              date_call: null,
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

    it('deve negar acesso se doctor_id não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-2',
        protocol: 'SC-0001',
        doctor_id: 'other-doctor',
      });

      const tool = getTool('get_surgery_request_status');
      const result = await tool.execute({ identifier: 'SC-0001' }, baseContext);

      expect(result).toContain('permissão');
    });

    it('deve retornar nomes e ações de pendências quando dados completos existirem', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-99',
        protocol: 'SC-664980',
        doctor_id: 'doctor-1',
      });

      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        id: 'req-99',
        protocol: 'SC-664980',
        status: 2,
        priority: 1,
        doctor_id: 'doctor-1',
        surgery_date: new Date('2026-06-15T00:00:00.000Z'),
        patient_id: 'pat-1',
        hospital_id: 'hos-1',
        health_plan_id: 'hp-1',
        patient: { name: 'Carlos Mendonça' },
        hospital: { name: 'Hospital Santa Helena' },
        health_plan: { name: 'Unimed' },
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

    it('deve retornar mensagem quando não há solicitações', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_surgery_requests');
      const result = await tool.execute({}, baseContext);

      expect(result).toContain('Nenhuma');
    });

    it('deve limitar a 10 resultados no máximo', async () => {
      mockSurgeryRequestRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_surgery_requests');
      await tool.execute({ limit: 100 }, baseContext);

      expect(mockSurgeryRequestRepo.findMany).toHaveBeenCalledWith(
        expect.anything(),
        0,
        10,
      );
    });
  });

  describe('get_documents', () => {
    it('deve listar documentos', async () => {
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        doctor_id: 'doctor-1',
        documents: [
          { name: 'Laudo.pdf', folder: 'laudos', created_at: '2025-01-01' },
        ],
      });

      const tool = getTool('get_documents');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Laudo.pdf');
    });

    it('deve retornar mensagem quando não há documentos', async () => {
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        doctor_id: 'doctor-1',
        documents: [],
      });

      const tool = getTool('get_documents');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Nenhum documento');
    });

    it('deve aceitar protocolo SC-XXXX em vez de UUID', async () => {
      mockSurgeryRequestRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          doctor_id: 'doctor-1',
          documents: [
            { name: 'Guia.pdf', folder: 'guias', created_at: '2025-01-01' },
          ],
        });
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({ id: 'req-42' });

      const tool = getTool('get_documents');
      const result = await tool.execute(
        { surgery_request_id: 'SC-664980' },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.findOneSimple).toHaveBeenCalledWith({
        protocol: 'SC-664980',
      });
      expect(result).toContain('Guia.pdf');
    });
  });

  describe('get_opme_items', () => {
    it('deve listar itens OPME', async () => {
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        doctor_id: 'doctor-1',
        opme_items: [
          { name: 'Prótese de quadril', quantity: 1, supplier: 'MedCorp' },
        ],
      });

      const tool = getTool('get_opme_items');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Prótese de quadril');
      expect(result).toContain('MedCorp');
    });

    it('deve retornar mensagem quando não há itens OPME', async () => {
      mockSurgeryRequestRepo.findOne.mockResolvedValue({
        doctor_id: 'doctor-1',
        opme_items: [],
      });

      const tool = getTool('get_opme_items');
      const result = await tool.execute(
        { surgery_request_id: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Nenhum item OPME');
    });
  });
});
