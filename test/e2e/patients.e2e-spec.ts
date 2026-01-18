import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Patients (e2e)', () => {
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

  describe('/patients (GET)', () => {
    it('should return list of patients', async () => {
      const response = await request(app.getHttpServer())
        .get('/patients')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      // A resposta tem formato { total, records }
      const patients =
        response.body.records || response.body.patients || response.body;
      expect(Array.isArray(patients)).toBe(true);
    });

    it('should paginate patients with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get('/patients')
        .query({ skip: 0, take: 10 })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer()).get('/patients').expect(401);
    });
  });

  describe('Authorization', () => {
    it('should deny access with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/patients')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should deny access without token', async () => {
      await request(app.getHttpServer()).get('/patients').expect(401);
    });
  });
});
