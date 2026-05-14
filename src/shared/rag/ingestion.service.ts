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
    maxTokens?: number;
    overlapTokens?: number;
  }): Promise<void> {
    const chunks = this.splitIntoChunks(
      data.content,
      data.maxTokens ?? 500,
      data.overlapTokens ?? 50,
    );

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
    options?: { maxTokens?: number; overlapTokens?: number },
  ): Promise<void> {
    await this.knowledgeRepo.deactivateByCategory(category);
    for (const item of items) {
      await this.ingest({ category, ...item, ...options });
    }
  }

  /**
   * Divide o texto em chunks baseados em tokens (heurística `chars/4`) com
   * overlap configurável.
   *
   * Fase 7 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`:
   *  - Antes: por parágrafo, sem overlap → recall baixo em queries longas.
   *  - Agora: por janela de tokens com sliding window de `overlapTokens` →
   *    contexto preservado nas bordas de cada chunk.
   *
   * O overlap é implementado mantendo os últimos `overlapTokens` de caracteres
   * do chunk anterior no início do próximo. Isso garante que frases partidas
   * na fronteira de um chunk apareçam completas em pelo menos um deles.
   */
  splitIntoChunks(text: string, maxTokens = 500, overlapTokens = 50): string[] {
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;

    if (text.length <= maxChars) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);

      // Tenta quebrar no limite de parágrafo ou frase mais próximo antes de `end`.
      if (end < text.length) {
        const paraBreak = text.lastIndexOf('\n\n', end);
        const sentBreak = text.lastIndexOf('. ', end);
        const breakAt = Math.max(paraBreak, sentBreak);
        if (breakAt > start + overlapChars) {
          end =
            breakAt === paraBreak
              ? breakAt + 2 // após '\n\n'
              : breakAt + 2; // após '. '
        }
      }

      chunks.push(text.slice(start, end).trim());

      // Avança deslocando `overlapChars` para trás do final do chunk.
      const nextStart = end - overlapChars;
      start = nextStart > start ? nextStart : end;
    }

    return chunks.filter((c) => c.length > 0);
  }
}
