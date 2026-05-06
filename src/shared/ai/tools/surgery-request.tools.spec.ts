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
        { protocol: 'SC-0001', status: 1, patient: { name: 'Maria' } },
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
