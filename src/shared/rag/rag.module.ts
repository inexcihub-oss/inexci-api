import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiKnowledgeChunk } from '../../database/entities/ai-knowledge-chunk.entity';
import { AiKnowledgeChunkRepository } from '../../database/repositories/ai-knowledge-chunk.repository';
import { RagService } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { IngestionService } from './ingestion.service';
import { OpenaiService } from '../ai/services/openai.service';
import { RagBootstrapService } from './rag-bootstrap.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiKnowledgeChunk])],
  providers: [
    AiKnowledgeChunkRepository,
    OpenaiService,
    EmbeddingService,
    IngestionService,
    RagService,
    RagBootstrapService,
  ],
  exports: [RagService, EmbeddingService, IngestionService],
})
export class RagModule {}
