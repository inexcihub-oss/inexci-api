import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { IngestionService } from './ingestion.service';
import { FAQ_SEED, GLOSSARY_SEED, WORKFLOW_SEED } from './knowledge-base.seed';

interface StructuredFaqItem {
  question: string;
  answer: string;
}

interface StructuredWorkflowItem {
  title: string;
  content: string;
}

interface StructuredGlossaryItem {
  term: string;
  definition: string;
}

interface StructuredKnowledgeFile {
  categories?: {
    faq?: StructuredFaqItem[];
    workflow?: StructuredWorkflowItem[];
    glossary?: StructuredGlossaryItem[];
    assistant_capabilities?: string[];
    faq_candidates_from_repository?: string[];
    whatsapp_full_flow_gap_analysis?: {
      missing_tools_for_full_flow?: string[];
    };
  };
}

@Injectable()
export class RagBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(RagBootstrapService.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const isSchemaReady = await this.isRagSchemaReady();
    if (!isSchemaReady) {
      this.logger.warn(
        'Schema RAG ainda não está pronto (tabela/coluna embedding ausente). Seed automático ignorado.',
      );
      return;
    }

    const hasActiveChunks = await this.hasAnyActiveChunk();
    if (hasActiveChunks) {
      this.logger.log('RAG já inicializado. Seed automático ignorado.');
      return;
    }

    try {
      const structured = this.loadStructuredKnowledgeFile();
      await this.seedFromStructuredFile(structured);
      this.logger.log(
        'RAG seedado automaticamente a partir do arquivo estruturado.',
      );
      return;
    } catch (error) {
      this.logger.warn(
        `Falha ao carregar seed estruturado de RAG. Usando seed padrão. Motivo: ${(error as Error).message}`,
      );
    }

    try {
      await this.seedDefault();
      this.logger.log('RAG seedado automaticamente com base padrão.');
    } catch (error) {
      this.logger.error(
        `Falha ao aplicar seed padrão de RAG: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async isRagSchemaReady(): Promise<boolean> {
    try {
      const tableExists = await this.dataSource.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'ai_knowledge_chunk'
         LIMIT 1`,
      );

      if (!tableExists.length) return false;

      const embeddingColumnExists = await this.dataSource.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ai_knowledge_chunk'
           AND column_name = 'embedding'
         LIMIT 1`,
      );

      if (embeddingColumnExists.length > 0) return true;

      this.logger.warn(
        'Coluna embedding não encontrada em ai_knowledge_chunk. Tentando criar automaticamente.',
      );

      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.dataSource.query(
        'ALTER TABLE ai_knowledge_chunk ADD COLUMN IF NOT EXISTS embedding vector(1536)',
      );

      const embeddingColumnCreated = await this.dataSource.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ai_knowledge_chunk'
           AND column_name = 'embedding'
         LIMIT 1`,
      );

      return embeddingColumnCreated.length > 0;
    } catch (error) {
      this.logger.warn(
        `Não foi possível validar schema do RAG: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async hasAnyActiveChunk(): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        'SELECT 1 FROM ai_knowledge_chunk WHERE active = true LIMIT 1',
      );
      return result.length > 0;
    } catch (error) {
      this.logger.warn(
        `Não foi possível checar estado da base RAG: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private loadStructuredKnowledgeFile(): StructuredKnowledgeFile {
    const filePath = path.resolve(
      process.cwd(),
      'docs/rag-knowledge-structured.json',
    );

    if (!fs.existsSync(filePath)) {
      throw new Error(
        'Arquivo docs/rag-knowledge-structured.json não encontrado.',
      );
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as StructuredKnowledgeFile;
  }

  private async seedFromStructuredFile(
    data: StructuredKnowledgeFile,
  ): Promise<void> {
    const faq = (data.categories?.faq || []).map((item) => ({
      title: item.question,
      content: `Pergunta: ${item.question}\nResposta: ${item.answer}`,
    }));

    const workflow = (data.categories?.workflow || []).map((item) => ({
      title: item.title,
      content: item.content,
    }));

    const glossary = (data.categories?.glossary || []).map((item) => ({
      title: item.term,
      content: `${item.term}: ${item.definition}`,
    }));

    const whatsappCapabilities = (
      data.categories?.assistant_capabilities || []
    ).map((item) => ({
      title: 'Capacidade do assistente no WhatsApp',
      content: item,
    }));

    const faqCandidates = (
      data.categories?.faq_candidates_from_repository || []
    ).map((item) => ({
      title: 'Pergunta candidata do repositório',
      content: item,
    }));

    const whatsappGaps = (
      data.categories?.whatsapp_full_flow_gap_analysis
        ?.missing_tools_for_full_flow || []
    ).map((item) => ({
      title: 'Lacuna para fluxo completo via WhatsApp',
      content: item,
    }));

    await this.ingestionService.replaceCategory('faq', faq);
    await this.ingestionService.replaceCategory('workflow', workflow);
    await this.ingestionService.replaceCategory('glossary', glossary);
    await this.ingestionService.replaceCategory(
      'whatsapp-capabilities',
      whatsappCapabilities,
    );
    await this.ingestionService.replaceCategory(
      'faq-candidates',
      faqCandidates,
    );
    await this.ingestionService.replaceCategory('whatsapp-gap', whatsappGaps);
  }

  private async seedDefault(): Promise<void> {
    await this.ingestionService.replaceCategory(
      'faq',
      FAQ_SEED.map((item) => ({
        title: item.question,
        content: `Pergunta: ${item.question}\nResposta: ${item.answer}`,
      })),
    );

    await this.ingestionService.replaceCategory('workflow', WORKFLOW_SEED);
    await this.ingestionService.replaceCategory('glossary', GLOSSARY_SEED);
  }
}
