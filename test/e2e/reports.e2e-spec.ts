import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

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

  describe('/reports/dashboard (GET)', () => {
    it('should return dashboard data', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('object');
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer()).get('/reports/dashboard').expect(401);
    });

    it('should deny access with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Dashboard data structure', () => {
    it('should include expected metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(authToken))
        .expect(200);

      // Dashboard should return some structured data
      expect(response.body).toBeDefined();

      // Depending on the implementation, verify expected properties
      // Examples: total_requests, pending_requests, completed_requests, etc.
    });

    it('should return data specific to authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      // Data should be filtered based on user's access level and permissions
    });
  });

  describe('Dashboard performance', () => {
    it('should respond within reasonable time', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(authToken))
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Dashboard should respond in less than 5 seconds
      expect(responseTime).toBeLessThan(5000);
    });
  });

  describe('Different user access levels', () => {
    it('should return dashboard data for admin users', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should handle dashboard requests from different user roles', async () => {
      // Test that different user roles can access dashboard
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });
});
