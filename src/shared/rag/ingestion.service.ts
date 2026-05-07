import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { AiKnowledgeChunkRepository } from '../../database/repositories/ai-knowledge-chunk.repository';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly knowledgeRepo: AiKnowledgeChunkRepository,
  ) {}

  async ingest(data: {
    category: string;
    title: string;
    content: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const chunks = this.splitIntoChunks(data.content, 500);

    for (const [index, chunk] of chunks.entries()) {
      const embedding = await this.embeddingService.generate(chunk);
      const vectorStr = this.embeddingService.toSqlVector(embedding);

      await this.knowledgeRepo.create({
        category: data.category,
        title:
          chunks.length > 1 ? `${data.title} (parte ${index + 1})` : data.title,
        content: chunk,
        metadata: data.metadata ?? null,
        embedding: vectorStr,
        active: true,
      });
    }

    this.logger.log(
      `Ingerido: "${data.title}" — ${chunks.length} chunk(s) na categoria "${data.category}"`,
    );
  }

  async ingestFaq(
    items: Array<{ question: string; answer: string }>,
  ): Promise<void> {
    for (const item of items) {
      const text = `Pergunta: ${item.question}\nResposta: ${item.answer}`;
      await this.ingest({
        category: 'faq',
        title: item.question,
        content: text,
      });
    }
  }

  async replaceCategory(
    category: string,
    items: Array<{
      title: string;
      content: string;
      metadata?: Record<string, any>;
    }>,
  ): Promise<void> {
    await this.knowledgeRepo.deactivateByCategory(category);
    for (const item of items) {
      await this.ingest({ category, ...item });
    }
  }

  private splitIntoChunks(text: string, maxTokens: number): string[] {
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      if ((current + para).length / 4 > maxTokens && current) {
        chunks.push(current.trim());
        current = '';
      }
      current += para + '\n\n';
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [text];
  }
}
