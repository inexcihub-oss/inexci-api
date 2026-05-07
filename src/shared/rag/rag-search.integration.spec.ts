/**
 * Teste de integração ponta a ponta do RAG (Fase 5 do PLANO-RAG-PIPELINE).
 *
 * Requer Postgres com pgvector + chunks já seedados. Roda apenas quando a
 * variável `RAG_INTEGRATION_E2E=1` está definida — caso contrário o suite é
 * skipado e não bloqueia a suíte unitária.
 *
 * Uso:
 *   RAG_INTEGRATION_E2E=1 OPENAI_API_KEY=sk-... DATABASE_URL=postgres://... \
 *     yarn test --testPathPattern=rag-search.integration
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { RagModule } from './rag.module';
import { RagService } from './rag.service';
import { AiKnowledgeChunk } from '../../database/entities/ai-knowledge-chunk.entity';

const SHOULD_RUN = process.env.RAG_INTEGRATION_E2E === '1';
const describeOrSkip = SHOULD_RUN ? describe : describe.skip;

const QUERIES = [
  'qual o status da SC-0042',
  'quais pendências da SC-0042',
  'como funciona OPME',
  'limite de mensagens whatsapp',
  'como faturar uma cirurgia',
];

describeOrSkip('RAG search (integração)', () => {
  let moduleRef: TestingModule;
  let ragService: RagService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [AiKnowledgeChunk],
          synchronize: false,
        }),
        RagModule,
      ],
    }).compile();

    ragService = moduleRef.get<RagService>(RagService);
  }, 30000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  it.each(QUERIES)(
    'retorna ao menos 1 chunk com score >= 0.65 para "%s"',
    async (query) => {
      const results = await ragService.search(query, 5, 0.65);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0.65);
    },
    30000,
  );
});
