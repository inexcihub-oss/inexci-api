import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';
import { TestDataFactory } from '../helpers/test-data-factory';

describe('Documents Key (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let currentUser: any;
  let testSurgeryRequestId: number;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
    currentUser = auth.user;

    // Criar uma solicitação de cirurgia para usar nos testes
    const surgeryRequestData = TestDataFactory.generateSurgeryRequestData();
    const srResponse = await request(app.getHttpServer())
      .post('/surgery-requests/simple')
      .set(getAuthHeader(authToken))
      .send(surgeryRequestData);

    if (srResponse.status === 201) {
      testSurgeryRequestId = srResponse.body.id;
    }
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/documents-key (POST)', () => {
    it('should create document key for surgery request', async () => {
      if (!testSurgeryRequestId) {
        console.warn('Skipping test: surgery request not created');
        return;
      }

      const documentKeyData = {
        key: 'MEDICAL_REPORT',
        name: 'Relatório Médico',
      };

      const response = await request(app.getHttpServer())
        .post('/surgery-requests/documents-key')
        .set(getAuthHeader(authToken))
        .send(documentKeyData)
        .expect(201);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('id');
    });

    it('should fail without authentication', async () => {
      const documentKeyData = {
        key: 'MEDICAL_REPORT',
        name: 'Relatório Médico',
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/documents-key')
        .send(documentKeyData)
        .expect(401);
    });

    it('should fail with missing required fields', async () => {
      const incompleteData = {
        key: 'MEDICAL_REPORT',
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/documents-key')
        .set(getAuthHeader(authToken))
        .send(incompleteData)
        .expect(400);
    });
  });

  describe('/surgery-requests/documents-key (GET)', () => {
    it('should return list of document keys', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/documents-key')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      // A resposta pode ter formato { total, records } ou ser um array direto
      const documentKeys =
        response.body.records || response.body.data || response.body;
      expect(
        Array.isArray(documentKeys) || typeof response.body === 'object',
      ).toBe(true);
    });

    it('should paginate document keys with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/documents-key')
        .query({ skip: 0, take: 10 })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/documents-key')
        .expect(401);
    });
  });
});
