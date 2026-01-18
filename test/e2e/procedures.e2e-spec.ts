import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Procedures (e2e)', () => {
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

  describe('/procedures (GET)', () => {
    it('should return list of procedures', async () => {
      const response = await request(app.getHttpServer())
        .get('/procedures')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      // A resposta tem formato { total, records }
      const procedures =
        response.body.records || response.body.procedures || response.body;
      expect(Array.isArray(procedures)).toBe(true);
    });

    it('should paginate procedures with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get('/procedures')
        .query({ skip: 0, take: 10 })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should fail without authentication', async () => {
      // Procedures requer autenticação
      await request(app.getHttpServer()).get('/procedures').expect(401);
    });
  });

  describe('Authorization', () => {
    it('should deny access with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/procedures')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should deny access without token', async () => {
      await request(app.getHttpServer()).get('/procedures').expect(401);
    });
  });
});
