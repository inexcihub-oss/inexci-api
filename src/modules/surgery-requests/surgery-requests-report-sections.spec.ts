// Mock Supabase para evitar validação de URL no nível do módulo
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: jest.fn() },
    storage: {
      from: jest.fn(() => ({ upload: jest.fn(), getPublicUrl: jest.fn() })),
    },
  })),
}));

import { Repository } from 'typeorm';
import { SurgeryRequestsService } from './surgery-requests.service';
import { ReportSection } from 'src/database/entities/report-section.entity';

/**
 * Testes unitários focados nas funcionalidades dos PRDs:
 * - PRD Reformulação Laudos (sections dinâmicas)
 * - PRD Registro PDF Histórico
 * - PRD Modal Confirmação Notificação
 *
 * Usa instanciação direta com mocks para evitar problemas de DI com repositórios
 * que dependem de DataSource/TypeORM no construtor.
 */
describe('SurgeryRequestsService — Report Sections (PRD Laudos)', () => {
  let service: SurgeryRequestsService;
  let mockReportSectionRepo: Partial<Repository<ReportSection>>;

  // Mocks mínimos para as dependências do SurgeryRequestsService
  const mockDataSource = { transaction: jest.fn(), query: jest.fn() };
  const mockEmailService = { send: jest.fn() };
  const mockMailService = { send: jest.fn(), sendStatusUpdate: jest.fn() };
  const mockPdfService = { generateSurgeryRequestLaudoPdf: jest.fn() };
  const mockPdfGenerationService = { scheduleGeneration: jest.fn() };
  const mockPendencyValidatorService = { validate: jest.fn() };
  const mockUserService = { findOne: jest.fn() };
  const mockStorageService = { create: jest.fn(), getSignedUrl: jest.fn() };
  const mockDocumentsService = {};
  const mockDocumentsKeyService = {};
  const mockUserRepository = { findOne: jest.fn(), findOneSimple: jest.fn() };
  const mockPatientRepository = {};
  const mockHospitalRepository = {};
  const mockHealthPlanRepository = {};
  const mockDoctorProfileRepository = {};
  const mockSurgeryRequestRepository = {
    findOneSimple: jest.fn(),
    findOne: jest.fn(),
  };
  const mockStatusUpdateRepository = {};
  const mockQuotationRepository = {};
  const mockAnalysisRepository = {};
  const mockBillingRepository = {};
  const mockContestationRepository = {};
  const mockWhatsappService = { sendMessage: jest.fn() };

  beforeEach(() => {
    mockReportSectionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };

    // Instanciação direta — mesma ordem do construtor do SurgeryRequestsService
    service = new SurgeryRequestsService(
      mockDataSource as any,
      mockEmailService as any,
      mockMailService as any,
      mockPdfService as any,
      mockPdfGenerationService as any,
      mockPendencyValidatorService as any,
      mockUserService as any,
      mockStorageService as any,
      mockDocumentsService as any,
      mockDocumentsKeyService as any,
      mockUserRepository as any,
      mockPatientRepository as any,
      mockHospitalRepository as any,
      mockHealthPlanRepository as any,
      mockDoctorProfileRepository as any,
      mockSurgeryRequestRepository as any,
      mockStatusUpdateRepository as any,
      mockQuotationRepository as any,
      mockAnalysisRepository as any,
      mockBillingRepository as any,
      mockContestationRepository as any,
      mockReportSectionRepo as any,
      mockWhatsappService as any,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD: Reformulação Laudos — US-003 (CRUD sections) ──────────────────
  describe('getReportSections', () => {
    it('deve retornar sections ordenadas por order ASC', async () => {
      const mockSections = [
        { id: '1', title: 'Histórico', order: 0, surgery_request_id: 'req-1' },
        { id: '2', title: 'Conduta', order: 1, surgery_request_id: 'req-1' },
      ];
      (mockReportSectionRepo.find as jest.Mock).mockResolvedValue(mockSections);

      const result = await service.getReportSections('req-1', 'user-1');

      expect(mockReportSectionRepo.find).toHaveBeenCalledWith({
        where: { surgery_request_id: 'req-1' },
        order: { order: 'ASC' },
      });
      expect(result).toEqual(mockSections);
    });
  });

  describe('createReportSection', () => {
    it('deve criar section com título e descrição', async () => {
      (mockReportSectionRepo.count as jest.Mock).mockResolvedValue(0);
      const newSection = {
        id: 'sec-1',
        title: 'Diagnóstico',
        description: '<p>Detalhes</p>',
        order: 0,
        surgery_request_id: 'req-1',
      };
      (mockReportSectionRepo.create as jest.Mock).mockReturnValue(newSection);
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue(newSection);

      const result = await service.createReportSection(
        'req-1',
        { title: 'Diagnóstico', description: '<p>Detalhes</p>' },
        'user-1',
      );

      expect(result.title).toBe('Diagnóstico');
      expect(result.description).toBe('<p>Detalhes</p>');
    });

    it('deve definir order como count de sections existentes', async () => {
      (mockReportSectionRepo.count as jest.Mock).mockResolvedValue(3);
      (mockReportSectionRepo.create as jest.Mock).mockReturnValue({});
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue({});

      await service.createReportSection(
        'req-1',
        { title: 'Nova seção' },
        'user-1',
      );

      expect(mockReportSectionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ order: 3 }),
      );
    });

    it('deve aceitar description como undefined (opcional)', async () => {
      (mockReportSectionRepo.count as jest.Mock).mockResolvedValue(0);
      (mockReportSectionRepo.create as jest.Mock).mockReturnValue({});
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue({});

      await service.createReportSection(
        'req-1',
        { title: 'Seção sem descrição' },
        'user-1',
      );

      expect(mockReportSectionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });
  });

  describe('updateReportSection', () => {
    it('deve atualizar título de section existente', async () => {
      const existing = { id: 'sec-1', title: 'Antigo', description: 'Desc' };
      (mockReportSectionRepo.findOne as jest.Mock).mockResolvedValue(existing);
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue({
        ...existing,
        title: 'Novo',
      });

      const result = await service.updateReportSection(
        'req-1',
        'sec-1',
        { title: 'Novo' },
        'user-1',
      );

      expect(existing.title).toBe('Novo');
    });

    it('deve lançar NotFoundException para section inexistente', async () => {
      (mockReportSectionRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateReportSection(
          'req-1',
          'sec-invalid',
          { title: 'X' },
          'user-1',
        ),
      ).rejects.toThrow('Seção não encontrada');
    });
  });

  describe('deleteReportSection', () => {
    it('deve deletar section e retornar { deleted: true }', async () => {
      (mockReportSectionRepo.delete as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      const result = await service.deleteReportSection(
        'req-1',
        'sec-1',
        'user-1',
      );

      expect(result).toEqual({ deleted: true });
    });

    it('deve retornar { deleted: false } quando section não encontrada', async () => {
      (mockReportSectionRepo.delete as jest.Mock).mockResolvedValue({
        affected: 0,
      });

      const result = await service.deleteReportSection(
        'req-1',
        'sec-invalid',
        'user-1',
      );

      expect(result).toEqual({ deleted: false });
    });
  });

  // ─── PRD: Reformulação Laudos — US-003 (reorder) ────────────────────────
  describe('reorderReportSections', () => {
    it('deve atualizar ordem das sections com base nos IDs fornecidos', async () => {
      (mockReportSectionRepo.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (mockReportSectionRepo.find as jest.Mock).mockResolvedValue([]);

      await service.reorderReportSections(
        'req-1',
        { ids: ['sec-3', 'sec-1', 'sec-2'] },
        'user-1',
      );

      // Verifica que update foi chamado com order correto para cada ID
      expect(mockReportSectionRepo.update).toHaveBeenCalledWith(
        { id: 'sec-3', surgery_request_id: 'req-1' },
        { order: 0 },
      );
      expect(mockReportSectionRepo.update).toHaveBeenCalledWith(
        { id: 'sec-1', surgery_request_id: 'req-1' },
        { order: 1 },
      );
      expect(mockReportSectionRepo.update).toHaveBeenCalledWith(
        { id: 'sec-2', surgery_request_id: 'req-1' },
        { order: 2 },
      );
    });
  });
});
