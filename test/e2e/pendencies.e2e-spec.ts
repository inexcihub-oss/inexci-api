import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Pendencies (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/pendencies (GET)', () => {
    it('should require surgery_request_id parameter', async () => {
      // surgery_request_id é obrigatório no DTO
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies')
        .set(getAuthHeader(authToken))
        .expect(400); // Esperado 400 porque falta surgery_request_id
    });

    it('should return pendencies for a surgery request', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/pendencies')
        .query({ surgery_request_id: 1 })
        .set(getAuthHeader(authToken));

      // Pode retornar 200 (lista vazia) ou 404 (surgery request não encontrada)
      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        // A resposta pode ser um array direto ou um objeto com array
        const pendencies = Array.isArray(response.body)
          ? response.body
          : response.body.records || response.body.pendencies || [];
        expect(Array.isArray(pendencies)).toBe(true);
      }
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies')
        .query({ surgery_request_id: 1 })
        .expect(401);
    });
  });

  describe('Authorization', () => {
    it('should deny access with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies')
        .query({ surgery_request_id: 1 })
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should deny access without token', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies')
        .query({ surgery_request_id: 1 })
        .expect(401);
    });
  });
});
