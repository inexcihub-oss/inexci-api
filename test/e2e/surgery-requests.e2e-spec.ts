import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

/**
 * Rotas de borda do módulo de solicitações cirúrgicas: contrato de listagem,
 * contrato de paginação e o tratamento do id pelo `SurgeryRequestOwnerGuard`.
 *
 * O caminho feliz (PENDING → ... → FINALIZED) e as transições inválidas vivem
 * em `surgery-request-full-flow.e2e-spec.ts`, que monta a SC de verdade via
 * HTTP — não duplicar aqui.
 *
 * O usuário destes testes é um admin criado direto no banco, sem
 * `doctor_profile` e sem vínculo `user_doctor_access`: nenhum médico acessível.
 * É o cenário barato para verificar contratos de resposta e autorização, e a
 * razão de a listagem vir sempre vazia.
 */
describe('Surgery Requests (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  // Uuid bem formado que nunca existe no banco — separa "id malformado" (barrado
  // no guard antes de virar SQL) de "id inexistente" (barrado após o SELECT).
  const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    // Sem `seedTestData`: ele roda antes de existir qualquer usuário (o
    // TRUNCATE acabou de zerar `users`), então é no-op aqui — e nenhum teste
    // deste arquivo depende do catálogo de procedimentos.
    await cleanDatabase(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests (GET)', () => {
    it('deve devolver { total, records } vazio para usuário sem médicos acessíveis', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests')
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      // `findAll` corta cedo quando `getAccessibleDoctorIds` volta vazio: o
      // recorte por médico é a barreira de tenant, não um filtro cosmético.
      expect(response.body).toEqual({ total: 0, records: [] });
    });

    it('deve aceitar filtro de status como lista de números separados por vírgula', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests')
        .query({
          status: `${SurgeryRequestStatus.PENDING},${SurgeryRequestStatus.SENT}`,
        })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
    });

    it('deve aceitar paginação por skip/take', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests')
        .query({ skip: 0, take: 10 })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
    });

    // O ValidationPipe global roda com `forbidNonWhitelisted`, então page/limit
    // não são ignorados silenciosamente — quebram a requisição. Esta é a única
    // forma de o teste acima significar algo: sem o contraste, um rename de
    // `take` passaria batido (a lista vazia continuaria vindo 200).
    it('deve recusar o contrato antigo de paginação (page/limit)', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests')
        .query({ page: 1, limit: 10 })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(400);
    });

    it('deve exigir autenticação', async () => {
      const response = await request(app.getHttpServer()).get(
        '/surgery-requests',
      );
      expect(response.status).toBe(401);
    });
  });

  // O `SurgeryRequestOwnerGuard` resolve o id da SC de três origens distintas
  // (params, query e body) e roda ANTES do ValidationPipe. Cada bloco abaixo
  // cobre uma dessas origens: um id malformado que escapasse daqui chegaria cru
  // a um WHERE sobre coluna `uuid` e viraria 500.

  describe('/surgery-requests/one (GET) — id vindo da query', () => {
    it('deve responder 404 (nunca 500) para id fora do formato uuid', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/one')
        .query({ id: 999999 })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(404);
    });

    it('deve responder 404 para uuid válido inexistente', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/one')
        .query({ id: UUID_INEXISTENTE })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(404);
    });

    it('deve exigir autenticação', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/one')
        .query({ id: UUID_INEXISTENTE });
      expect(response.status).toBe(401);
    });
  });

  describe('/surgery-requests/:id/has-opme (PATCH) — id vindo do param', () => {
    it('deve responder 404 (nunca 500) para id fora do formato uuid', async () => {
      const response = await request(app.getHttpServer())
        .patch('/surgery-requests/invalid/has-opme')
        .set(getAuthHeader(authToken))
        .send({ hasOpme: false });

      expect(response.status).toBe(404);
    });

    it('deve responder 404 (nunca 500) para id numérico', async () => {
      const response = await request(app.getHttpServer())
        .patch('/surgery-requests/1/has-opme')
        .set(getAuthHeader(authToken))
        .send({ hasOpme: false });

      expect(response.status).toBe(404);
    });

    it('deve responder 404 para uuid válido inexistente', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/surgery-requests/${UUID_INEXISTENTE}/has-opme`)
        .set(getAuthHeader(authToken))
        .send({ hasOpme: false });

      expect(response.status).toBe(404);
    });

    it('deve exigir autenticação', async () => {
      const response = await request(app.getHttpServer())
        .patch('/surgery-requests/1/has-opme')
        .send({ hasOpme: false });
      expect(response.status).toBe(401);
    });
  });

  describe('/surgery-requests (PUT) — id vindo do corpo', () => {
    it('deve responder 404 (nunca 500) para id fora do formato uuid', async () => {
      const response = await request(app.getHttpServer())
        .put('/surgery-requests')
        .set(getAuthHeader(authToken))
        .send({ id: 1, priority: 3 });

      expect(response.status).toBe(404);
    });

    it('deve responder 404 para uuid válido inexistente', async () => {
      const response = await request(app.getHttpServer())
        .put('/surgery-requests')
        .set(getAuthHeader(authToken))
        .send({ id: UUID_INEXISTENTE, priority: 3 });

      expect(response.status).toBe(404);
    });

    it('deve exigir autenticação', async () => {
      const response = await request(app.getHttpServer())
        .put('/surgery-requests')
        .send({ id: UUID_INEXISTENTE });
      expect(response.status).toBe(401);
    });
  });
});

// ----------------------------------------------------------------------------
// Blocos removidos — todos batiam em rotas que não existem mais. Como o Nest
// responde 404 antes de qualquer guard quando nada casa, os asserts tolerantes
// (`expect([401, 404]).toContain(...)`) passavam justamente por isso: eram
// testes verdes que não exercitavam uma linha de produção.
//
// - `POST /surgery-requests/simple` → hoje é `POST /surgery-requests`. A criação
//   real (com todos os pré-requisitos) está no full-flow.
// - `POST /surgery-requests/{send,cancel,schedule,to-invoice,receive,
//   surgery-dates,complaint}` e `POST /surgery-requests/:id/{approve,deny,
//   transition}` → cada transição virou uma rota própria por `:id`
//   (`:id/send`, `:id/start-analysis`, `:id/accept-authorization`,
//   `:id/confirm-date`, `:id/mark-performed`, `:id/invoice`,
//   `:id/confirm-receipt`, `:id/close`, `:id/contest-authorization`,
//   `:id/contest-payment`). Não há mais transição genérica por número de status,
//   nem `cancel`: o encerramento é `:id/close`. O caminho completo, incluindo a
//   recusa de transições fora de ordem, é o `surgery-request-full-flow`.
// - `POST /surgery-requests/{invoice,contest}` com `.attach()` → além de a rota
//   não existir, o 404 chegava antes de o corpo ser consumido e o socket fechava
//   no meio do upload, produzindo `write EPIPE` intermitente.
// - `GET /surgery-requests/date-expired` → "data da cirurgia já passou" virou a
//   pendência não-bloqueante `surgery_expired` do status SCHEDULED
//   (`pendencies.config.ts`), que ainda não tem cobertura e2e.
// - `GET /surgery-requests/pendencies/quick-summary/:id` → o resumo é
//   `pendencies/summary/:id` (e `pendencies/batch-summary` para o kanban).
// - O bloco "Automatic Status Transitions" montava a SC pelo `/simple` morto,
//   então `testSurgeryRequestId` ficava indefinido e os dois testes retornavam
//   antes de qualquer assert. As rotas `pendencies/validate/:id` e
//   `pendencies/summary/:id` seguem sem cobertura e2e direta —
//   `pendencies.e2e-spec.ts` tem exatamente o mesmo setup morto. O que existe
//   hoje é cobertura indireta da regra de negócio: o `:id/send` do full-flow só
//   passa depois de resolver as 5 pendências bloqueantes de PENDING.
// ----------------------------------------------------------------------------
