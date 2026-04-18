import {
  Controller,
  Post,
  Body,
  Get,
  Query,
} from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { RagService } from './rag.service';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { FAQ_SEED, WORKFLOW_SEED, GLOSSARY_SEED } from './knowledge-base.seed';

class IngestDto {
  category: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

class IngestFaqDto {
  items: Array<{ question: string; answer: string }>;
}

@Controller('rag')
@Roles(UserRole.ADMIN)
export class RagController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly ragService: RagService,
  ) {}

  @Post('ingest')
  async ingest(@Body() dto: IngestDto) {
    await this.ingestionService.ingest(dto);
    return { message: 'Ingested successfully' };
  }

  @Post('ingest/faq')
  async ingestFaq(@Body() dto: IngestFaqDto) {
    await this.ingestionService.ingestFaq(dto.items);
    return { message: `Ingested ${dto.items.length} FAQ items` };
  }

  @Post('ingest/replace')
  async replaceCategory(
    @Body() dto: { category: string; items: Array<{ title: string; content: string }> },
  ) {
    await this.ingestionService.replaceCategory(dto.category, dto.items);
    return { message: `Category "${dto.category}" replaced` };
  }

  @Get('search')
  async search(@Query('q') query: string, @Query('k') k?: string) {
    const results = await this.ragService.search(query, k ? parseInt(k) : 3);
    return { results };
  }

  @Post('seed')
  async seedKnowledgeBase() {
    await this.ingestionService.replaceCategory('faq', FAQ_SEED.map(f => ({
      title: f.question,
      content: `Pergunta: ${f.question}\nResposta: ${f.answer}`,
    })));
    await this.ingestionService.replaceCategory('workflow', WORKFLOW_SEED);
    await this.ingestionService.replaceCategory('glossary', GLOSSARY_SEED);
    return { message: 'Base de conhecimento inicial carregada com sucesso.' };
  }
}
