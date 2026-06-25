import { DataSource, Repository } from 'typeorm';
import { SurgeryRequestReportService } from './services/surgery-request-report.service';
import { ReportSection } from 'src/database/entities/report-section.entity';

/**
 * Testes unitários focados nas funcionalidades dos PRDs:
 * - PRD Reformulação Laudos (sections dinâmicas)
 * - PRD Registro PDF Histórico
 * - PRD Modal Confirmação Notificação
 *
 * Testa o SurgeryRequestReportService diretamente (lógica real),
 * não o SurgeryRequestsService que agora é apenas fachada.
 */
describe('SurgeryRequestReportService — Report Sections (PRD Laudos)', () => {
  let service: SurgeryRequestReportService;
  let mockReportSectionRepo: Partial<Repository<ReportSection>>;

  const mockSurgeryRequestRepository = {
    findOneSimple: jest.fn(),
    findOne: jest.fn(),
    findOneWithRelations: jest.fn(),
    findOneWithAllRelations: jest.fn(),
  };
  const mockPdfAssemblyService = {
    generateLaudoPdf: jest.fn(),
  };
  const mockDataSource = { query: jest.fn() } as unknown as DataSource;

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
    (mockDataSource.query as jest.Mock).mockReset();
    (mockDataSource.query as jest.Mock).mockResolvedValue([]);

    // Instanciação direta do SurgeryRequestReportService — assinatura
    // atual: (reportSectionRepository, surgeryRequestRepository,
    // pdfAssemblyService, dataSource).
    service = new SurgeryRequestReportService(
      mockReportSectionRepo as any,
      mockSurgeryRequestRepository as any,
      mockPdfAssemblyService as any,
      mockDataSource,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD: Reformulação Laudos — US-003 (CRUD sections) ──────────────────
  describe('getReportSections', () => {
    it('deve retornar sections ordenadas por order ASC', async () => {
      const mockSections = [
        { id: '1', title: 'Histórico', order: 0, surgeryRequestId: 'req-1' },
        { id: '2', title: 'Conduta', order: 1, surgeryRequestId: 'req-1' },
      ];
      (mockReportSectionRepo.find as jest.Mock).mockResolvedValue(mockSections);

      const result = await service.getReportSections('req-1', 'user-1');

      expect(mockReportSectionRepo.find).toHaveBeenCalledWith({
        where: { surgeryRequestId: 'req-1' },
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
        surgeryRequestId: 'req-1',
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

  // ─── Segurança VULN-02: sanitização XSS nas seções de laudo ────────────────
  describe('sanitização de seções de laudo (VULN-02)', () => {
    it('deve remover tag <script> do title antes de salvar', async () => {
      (mockReportSectionRepo.count as jest.Mock).mockResolvedValue(0);
      (mockReportSectionRepo.create as jest.Mock).mockReturnValue({});
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue({});

      await service.createReportSection(
        'req-1',
        {
          title: '<script>alert("xss")</script>Diagnóstico',
          description: undefined,
        },
        'user-1',
      );

      const createArg = (mockReportSectionRepo.create as jest.Mock).mock
        .calls[0][0];
      expect(createArg.title).not.toContain('<script>');
      expect(createArg.title).toContain('Diagnóstico');
    });

    it('deve remover atributos onerror/onclick do description', async () => {
      (mockReportSectionRepo.count as jest.Mock).mockResolvedValue(0);
      (mockReportSectionRepo.create as jest.Mock).mockReturnValue({});
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue({});

      await service.createReportSection(
        'req-1',
        {
          title: 'Título',
          description: '<b onclick="steal()">texto</b>',
        },
        'user-1',
      );

      const createArg = (mockReportSectionRepo.create as jest.Mock).mock
        .calls[0][0];
      expect(createArg.description).not.toContain('onclick');
      expect(createArg.description).toContain('texto');
    });

    it('deve remover <script> do description no updateReportSection', async () => {
      const existing = {
        id: 'sec-1',
        title: 'Título',
        description: 'original',
      };
      (mockReportSectionRepo.findOne as jest.Mock).mockResolvedValue(existing);
      (mockReportSectionRepo.save as jest.Mock).mockResolvedValue(existing);

      await service.updateReportSection(
        'req-1',
        'sec-1',
        {
          description:
            '<p>Válido</p><script>fetch("http://attacker.com")</script>',
        },
        'user-1',
      );

      expect(existing.description).not.toContain('<script>');
      expect(existing.description).toContain('<p>Válido</p>');
    });
  });

  // ─── PRD: Reformulação Laudos — US-003 (reorder) ────────────────────────
  describe('reorderReportSections', () => {
    it('deve executar batch update com dataSource.query para todas as sections', async () => {
      (mockReportSectionRepo.find as jest.Mock).mockResolvedValue([]);

      await service.reorderReportSections(
        'req-1',
        { ids: ['sec-3', 'sec-1', 'sec-2'] },
        'user-1',
      );

      // Batch: apenas 1 query em vez de N updates individuais
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (mockDataSource.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('UPDATE report_section rs');
      expect(sql).toContain('VALUES');
      expect(params).toContain('sec-3');
      expect(params).toContain('sec-1');
      expect(params).toContain('sec-2');
      expect(params).toContain(0);
      expect(params).toContain(1);
      expect(params).toContain(2);
      expect(params).toContain('req-1');
    });

    it('deve retornar lista vazia sem executar query quando ids está vazio', async () => {
      (mockReportSectionRepo.find as jest.Mock).mockResolvedValue([]);

      await service.reorderReportSections('req-1', { ids: [] }, 'user-1');

      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });
});
