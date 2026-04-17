import { Injectable } from '@nestjs/common';
import { OpenaiService } from '../ai/services/openai.service';

@Injectable()
export class EmbeddingService {
  constructor(private readonly openaiService: OpenaiService) {}

  async generate(text: string): Promise<number[]> {
    return this.openaiService.createEmbedding(text);
  }

  toSqlVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
