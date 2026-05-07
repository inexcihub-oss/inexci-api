import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import { RagBootstrapService } from './rag-bootstrap.service';
import { IngestionService } from './ingestion.service';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

const mockIngestionService = {
  replaceCategory: jest.fn(),
  ingest: jest.fn(),
};

const mockDataSource = {
  query: jest.fn(),
};

const STRUCTURED_FIXTURE = {
  categories: {
    faq: [
      {
        id: 'faq_001',
        question: 'Q1',
        answer: 'A1',
        tags: ['t1'],
      },
    ],
    workflow: [
      { id: 'wf_001', title: 'WF1', content: 'C1', source: 'src/x.ts' },
    ],
    glossary: [{ term: 'TUSS', definition: 'Def TUSS', source: 'ANS' }],
    assistant_capabilities: ['Cap 1'],
    assistant_limitations: ['Lim 1'],
    whatsapp_intents_examples: [
      { intent: 'consulta_status', examples: ['ex1', 'ex2'] },
    ],
    pendencies: [
      {
        status: 'Pendente',
        blocking_items: ['Hospital', 'TUSS'],
        non_blocking_items: [],
        source: 'inexci-api/src/config/pendencies.config.ts',
      },
    ],
    faq_candidates_from_repository: ['Cand 1'],
    whatsapp_full_flow_gap_analysis: {
      open_items: ['Gap 1'],
    },
  },
};

function tableExistsRow() {
  return [{ '?column?': 1 }];
}

describe('RagBootstrapService', () => {
  let service: RagBootstrapService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagBootstrapService,
        { provide: IngestionService, useValue: mockIngestionService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<RagBootstrapService>(RagBootstrapService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aborta seed e loga erro quando schema não está pronto (tabela ausente)', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);

    await service.onModuleInit();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Schema RAG não está pronto'),
    );
    expect(mockIngestionService.replaceCategory).not.toHaveBeenCalled();
  });

  it('aborta seed quando coluna embedding está ausente', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce([]);

    await service.onModuleInit();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Schema RAG não está pronto'),
    );
    expect(mockIngestionService.replaceCategory).not.toHaveBeenCalled();
  });

  it('NÃO executa DDL ao validar schema (apenas information_schema)', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow());

    await service.onModuleInit();

    const ddlCalls = mockDataSource.query.mock.calls.filter(([sql]) =>
      /CREATE\s+EXTENSION|ALTER\s+TABLE|CREATE\s+TABLE/i.test(sql),
    );
    expect(ddlCalls).toHaveLength(0);
  });

  it('skip silencioso quando base já populada', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow());

    await service.onModuleInit();

    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('RAG já inicializado'),
    );
    expect(mockIngestionService.replaceCategory).not.toHaveBeenCalled();
  });

  it('seed completo quando schema ok e base vazia', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce([]);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(STRUCTURED_FIXTURE));

    await service.onModuleInit();

    const calls = mockIngestionService.replaceCategory.mock.calls.map(
      ([cat]) => cat,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'faq',
        'workflow',
        'glossary',
        'whatsapp-capabilities',
        'faq-candidates',
        'whatsapp-gap',
        'pendencies',
        'assistant-limitations',
        'whatsapp-intents',
      ]),
    );
  });

  it('propaga metadata estruturado nos itens FAQ (tags + id)', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce([]);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(STRUCTURED_FIXTURE));

    await service.onModuleInit();

    const faqCall = mockIngestionService.replaceCategory.mock.calls.find(
      ([cat]) => cat === 'faq',
    );
    expect(faqCall).toBeDefined();
    const faqItems = faqCall![1] as Array<{
      title: string;
      metadata: Record<string, any>;
    }>;
    expect(faqItems[0].metadata).toMatchObject({
      source: 'faq',
      id: 'faq_001',
      tags: ['t1'],
    });
  });

  it('mapeia pendências com título e content esperados', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce([]);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(STRUCTURED_FIXTURE));

    await service.onModuleInit();

    const pendCall = mockIngestionService.replaceCategory.mock.calls.find(
      ([cat]) => cat === 'pendencies',
    );
    expect(pendCall).toBeDefined();
    const pendItems = pendCall![1] as Array<{
      title: string;
      content: string;
      metadata: Record<string, any>;
    }>;
    expect(pendItems[0].title).toBe('Pendências para status: Pendente');
    expect(pendItems[0].content).toContain('- Hospital');
    expect(pendItems[0].metadata).toMatchObject({
      status: 'Pendente',
      category_internal: 'pendencies',
    });
  });

  it('em produção, falha ao não encontrar arquivo estruturado (sem fallback)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    mockDataSource.query
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce(tableExistsRow())
      .mockResolvedValueOnce([]);
    mockedFs.existsSync.mockReturnValue(false);

    await expect(service.onModuleInit()).rejects.toThrow(
      /rag-knowledge-structured\.json não encontrado/,
    );

    process.env.NODE_ENV = prevEnv;
  });
});
