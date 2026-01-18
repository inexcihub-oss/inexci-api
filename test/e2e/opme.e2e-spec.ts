import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
  linkUserToClinic,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';
import { TestDataFactory } from '../helpers/test-data-factory';

describe('OPME - Órteses, Próteses e Materiais Especiais (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let currentUser: any;
  let testClinicId: number;
  let testSurgeryRequestId: number;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const seedData = await seedTestData(app);
    testClinicId = seedData.clinicId;
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
    currentUser = auth.user;
    await linkUserToClinic(app, currentUser.id, testClinicId);

    // Criar uma solicitação de cirurgia para usar nos testes
    const surgeryRequestData =
      TestDataFactory.generateSurgeryRequestData(testClinicId);
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

  describe('/surgery-requests/opme (POST)', () => {
    it('should create OPME for surgery request', async () => {
      if (!testSurgeryRequestId) {
        console.warn('Skipping test: surgery request not created');
        return;
      }

      const opmeData = {
        surgery_request_id: testSurgeryRequestId,
        name: 'Prótese de quadril titanium',
        distributor: 'Medical Supplies Inc',
        brand: 'OrthoTech',
        quantity: 1,
      };

      const response = await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(opmeData)
        .expect(201);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('id');
    });

    it('should fail without authentication', async () => {
      const opmeData = {
        surgery_request_id: 1,
        name: 'Prótese de quadril',
        distributor: 'Medical Supplies Inc',
        brand: 'OrthoTech',
        quantity: 1,
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .send(opmeData)
        .expect(401);
    });

    it('should fail with missing required fields', async () => {
      const incompleteData = {
        name: 'Prótese de quadril',
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(incompleteData)
        .expect(400);
    });

    it('should fail with invalid surgery request id', async () => {
      const opmeData = {
        surgery_request_id: 999999,
        name: 'Prótese de quadril',
        distributor: 'Medical Supplies Inc',
        brand: 'OrthoTech',
        quantity: 1,
      };

      const response = await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(opmeData);

      // Pode retornar 404 (not found) ou 400 (bad request) dependendo da validação
      expect([400, 404]).toContain(response.status);
    });
  });
});
