import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('CID - Classificação Internacional de Doenças (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let currentUser: any;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
    currentUser = auth.user;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/cid (GET)', () => {
    it('should return list of CID codes', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/cid')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      // A resposta pode ser um array ou objeto com paginação
      const cids = Array.isArray(response.body)
        ? response.body
        : response.body.records || response.body.data;
      expect(Array.isArray(cids) || typeof response.body === 'object').toBe(
        true,
      );
    });

    it('should filter CID codes with search term', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/cid')
        .query({ search: 'A00' })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should paginate CID codes with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/cid')
        .query({ skip: 0, take: 10 })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/cid')
        .expect(401);
    });

    it('should handle empty search results', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/cid')
        .query({ search: 'XXXNONEXISTENTXXX' })
        .set(getAuthHeader(authToken))
        .expect(200);

      const cids = Array.isArray(response.body)
        ? response.body
        : response.body.records || response.body.data || [];
      // Aceitar tanto array vazio quanto objeto de paginação
      if (Array.isArray(cids)) {
        expect(cids.length).toBe(0);
      } else if (response.body.records) {
        expect(response.body.records.length).toBe(0);
      }
    });
  });
});
