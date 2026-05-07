import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { IngestionService } from './ingestion.service';
import { FAQ_SEED, GLOSSARY_SEED, WORKFLOW_SEED } from './knowledge-base.seed';

interface StructuredFaqItem {
  id?: string;
  question: string;
  answer: string;
  tags?: string[];
}

interface StructuredWorkflowItem {
  id?: string;
  title: string;
  content: string;
  source?: string;
}

interface StructuredGlossaryItem {
  term: string;
  definition: string;
  source?: string;
}

interface StructuredPendencyItem {
  status: string;
  blocking_items?: string[];
  non_blocking_items?: string[];
  note?: string;
  source?: string;
}

interface StructuredIntentItem {
  intent: string;
  examples: string[];
}

interface StructuredKnowledgeFile {
  categories?: {
    faq?: StructuredFaqItem[];
    workflow?: StructuredWorkflowItem[];
    glossary?: StructuredGlossaryItem[];
    assistant_capabilities?: string[];
    assistant_limitations?: string[];
    whatsapp_intents_examples?: StructuredIntentItem[];
    pendencies?: StructuredPendencyItem[];
    faq_candidates_from_repository?: string[];
    whatsapp_full_flow_gap_analysis?: {
      missing_tools_for_full_flow?: string[];
      open_items?: string[];
    };
  };
}

const STATUS_LABEL_PT: Record<string, string> = {
  Pendente: 'Pendente',
  Enviada: 'Enviada',
  'Em Análise': 'Em Análise',
  'Em Agendamento': 'Em Agendamento',
  Agendada: 'Agendada',
  Realizada: 'Realizada',
  Faturada: 'Faturada',
  Finalizada: 'Finalizada',
  Encerrada: 'Encerrada',
};

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
      this.logger.error(
        'Schema RAG não está pronto. A migration `CreateAiKnowledgeChunkVector` precisa ter sido aplicada e a extensão pgvector instalada. Seed automático abortado.',
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
      const message = (error as Error).message;
      const env = (process.env.NODE_ENV || '').toLowerCase();
      const isProd = env === 'production';

      if (isProd) {
        this.logger.error(
          `Falha ao carregar seed estruturado de RAG em produção: ${message}`,
          (error as Error).stack,
        );
        throw error;
      }

      this.logger.warn(
        `Falha ao carregar seed estruturado de RAG (${env || 'sem NODE_ENV'}). Aplicando fallback default. Motivo: ${message}`,
      );

      try {
        await this.seedDefault();
        this.logger.log(
          'RAG seedado automaticamente com base padrão (fallback dev/test).',
        );
      } catch (fallbackError) {
        this.logger.error(
          `Falha ao aplicar seed padrão de RAG: ${(fallbackError as Error).message}`,
          (fallbackError as Error).stack,
        );
      }
    }
  }

  /**
   * Apenas valida (não cria/altera) presença de tabela e coluna `embedding`.
   * DDL deve ser aplicada exclusivamente via migrations TypeORM.
   */
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
      return embeddingColumnExists.length > 0;
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
      metadata: {
        source: 'faq',
        ...(item.id ? { id: item.id } : {}),
        ...(item.tags && item.tags.length ? { tags: item.tags } : {}),
      } as Record<string, any>,
    }));

    const workflow = (data.categories?.workflow || []).map((item) => ({
      title: item.title,
      content: item.content,
      metadata: {
        source: item.source ?? 'workflow',
        ...(item.id ? { id: item.id } : {}),
      } as Record<string, any>,
    }));

    const glossary = (data.categories?.glossary || []).map((item) => ({
      title: item.term,
      content: `${item.term}: ${item.definition}`,
      metadata: {
        source: item.source ?? 'glossary',
        term: item.term,
      } as Record<string, any>,
    }));

    const whatsappCapabilities = (
      data.categories?.assistant_capabilities || []
    ).map((item) => ({
      title: 'Capacidade do assistente no WhatsApp',
      content: item,
      metadata: { source: 'assistant_capabilities' } as Record<string, any>,
    }));

    const faqCandidates = (
      data.categories?.faq_candidates_from_repository || []
    ).map((item) => ({
      title: 'Pergunta candidata do repositório',
      content: item,
      metadata: { source: 'faq_candidates_from_repository' } as Record<
        string,
        any
      >,
    }));

    const whatsappGapItems = [
      ...(data.categories?.whatsapp_full_flow_gap_analysis
        ?.missing_tools_for_full_flow || []),
      ...(data.categories?.whatsapp_full_flow_gap_analysis?.open_items || []),
    ];
    const whatsappGaps = whatsappGapItems.map((item) => ({
      title: 'Lacuna para fluxo completo via WhatsApp',
      content: item,
      metadata: { source: 'whatsapp_full_flow_gap_analysis' } as Record<
        string,
        any
      >,
    }));

    const pendencies = (data.categories?.pendencies || []).map((item) => {
      const labelPt = STATUS_LABEL_PT[item.status] ?? item.status;
      const blocking = item.blocking_items?.length
        ? item.blocking_items.map((b) => `- ${b}`).join('\n')
        : '- (nenhum)';
      const nonBlocking = item.non_blocking_items?.length
        ? item.non_blocking_items.map((b) => `- ${b}`).join('\n')
        : '- (nenhum)';
      const noteLine = item.note ? `\nObservação: ${item.note}` : '';
      return {
        title: `Pendências para status: ${labelPt}`,
        content:
          `Status: ${labelPt}\n` +
          `Pendências bloqueantes:\n${blocking}\n` +
          `Pendências não bloqueantes:\n${nonBlocking}` +
          noteLine,
        metadata: {
          source: item.source ?? 'pendencies',
          status: item.status,
          category_internal: 'pendencies',
        } as Record<string, any>,
      };
    });

    const assistantLimitations = (
      data.categories?.assistant_limitations || []
    ).map((item) => ({
      title: 'Limitação do assistente',
      content: item,
      metadata: { source: 'assistant_limitations' } as Record<string, any>,
    }));

    const whatsappIntents = (
      data.categories?.whatsapp_intents_examples || []
    ).map((item) => ({
      title: `Intent: ${item.intent}`,
      content: `Intent: ${item.intent}\nExemplos:\n${item.examples
        .map((e) => `- ${e}`)
        .join('\n')}`,
      metadata: {
        source: 'whatsapp_intents_examples',
        intent: item.intent,
        category_internal: 'whatsapp-intents',
      } as Record<string, any>,
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
    await this.ingestionService.replaceCategory('pendencies', pendencies);
    await this.ingestionService.replaceCategory(
      'assistant-limitations',
      assistantLimitations,
    );
    await this.ingestionService.replaceCategory(
      'whatsapp-intents',
      whatsappIntents,
    );
  }

  /**
   * Fallback usado apenas em ambientes não-produtivos (dev/test) quando o
   * arquivo estruturado não estiver disponível. Em produção, ausência do
   * arquivo é erro fatal — seed nunca cai aqui.
   */
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
