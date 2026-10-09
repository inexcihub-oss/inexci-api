import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

describe('Surgery Requests (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
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
