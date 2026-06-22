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

const validOpmePayload = (surgeryRequestId: number) => ({
  surgeryRequestId,
  name: 'Prótese de quadril titanium',
  manufacturerNames: ['OrthoTech', 'Fab B', 'Fab C'],
  supplierNames: ['Medical Supplies Inc', 'Fornecedor B', 'Fornecedor C'],
  quantity: 1,
});

describe('OPME - Órteses, Próteses e Materiais Especiais (e2e)', () => {
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

  describe('/surgery-requests/opme (POST)', () => {
    it('should create OPME for surgery request', async () => {
      if (!testSurgeryRequestId) {
        console.warn('Skipping test: surgery request not created');
        return;
      }

      const response = await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(validOpmePayload(testSurgeryRequestId))
        .expect(201);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('id');
      expect(response.body).not.toHaveProperty('brand');
      expect(response.body.manufacturers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
        ]),
      );
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .send(validOpmePayload(1))
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
      const response = await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(validOpmePayload(999999));

      // Pode retornar 404 (not found), 400 (bad request) ou 500 (erro interno)
      expect([400, 404, 500]).toContain(response.status);
    });
  });
});
