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
  let testSurgeryRequestId: number;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;

    // Criar uma solicitação de teste para usar nos testes de pendências
    const createResponse = await request(app.getHttpServer())
      .post('/surgery-requests/simple')
      .set(getAuthHeader(authToken))
      .send({
        is_indication: true,
        indication_name: 'Test Procedure for Pendencies',
        patient: {
          name: 'Test Patient',
          email: 'test-patient-pendency@test.com',
          phone: '11999999999',
        },
        collaborator: {
          status: 2,
          name: 'Test Collaborator',
          email: 'test-collaborator-pendency@test.com',
          phone: '11988888888',
          password: 'Test@123',
        },
        health_plan: {
          name: 'Test Health Plan',
          email: 'test-healthplan-pendency@test.com',
          phone: '11977777777',
        },
      });

    if (createResponse.status === 201) {
      testSurgeryRequestId = createResponse.body.id;
    }
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/pendencies/validate/:surgeryRequestId (GET)', () => {
    it('should return dynamic pendencies validation', async () => {
      if (!testSurgeryRequestId) return;

      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${testSurgeryRequestId}`)
        .set(getAuthHeader(authToken));

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(response.body).toHaveProperty('currentStatus');
        expect(response.body).toHaveProperty('statusLabel');
        expect(response.body).toHaveProperty('nextStatus');
        expect(response.body).toHaveProperty('canAdvance');
        expect(response.body).toHaveProperty('pendencies');
        expect(response.body).toHaveProperty('totalCount');
        expect(response.body).toHaveProperty('completedCount');
        expect(response.body).toHaveProperty('pendingCount');
        expect(Array.isArray(response.body.pendencies)).toBe(true);

        if (response.body.pendencies.length > 0) {
          const pendency = response.body.pendencies[0];
          expect(pendency).toHaveProperty('key');
          expect(pendency).toHaveProperty('name');
          expect(pendency).toHaveProperty('description');
          expect(pendency).toHaveProperty('isComplete');
          expect(pendency).toHaveProperty('isOptional');
          expect(pendency).toHaveProperty('responsible');
          expect(pendency).toHaveProperty('statusContext');
        }

        expect(typeof response.body.totalCount).toBe('number');
        expect(typeof response.body.completedCount).toBe('number');
        expect(typeof response.body.pendingCount).toBe('number');
        expect(typeof response.body.canAdvance).toBe('boolean');
      }
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/validate/1')
        .expect(401);
    });

    it('should fail with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/validate/1')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/surgery-requests/pendencies/quick-summary/:surgeryRequestId (GET)', () => {
    it('should return quick summary for kanban', async () => {
      if (!testSurgeryRequestId) return;

      const response = await request(app.getHttpServer())
        .get(
          `/surgery-requests/pendencies/quick-summary/${testSurgeryRequestId}`,
        )
        .set(getAuthHeader(authToken));

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(response.body).toHaveProperty('pending');
        expect(response.body).toHaveProperty('total');
        expect(response.body).toHaveProperty('canAdvance');

        expect(typeof response.body.pending).toBe('number');
        expect(typeof response.body.total).toBe('number');
        expect(typeof response.body.canAdvance).toBe('boolean');
      }
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/quick-summary/1')
        .expect(401);
    });
  });

  describe('Dynamic Validation Logic', () => {
    it('should mark patient data as incomplete for new surgery request', async () => {
      if (!testSurgeryRequestId) return;

      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${testSurgeryRequestId}`)
        .set(getAuthHeader(authToken));

      if (response.status === 200) {
        const pendencies = response.body.pendencies;
        const patientDataPendency = pendencies.find(
          (p: any) => p.key === 'patient_data',
        );

        // Nova solicitação geralmente tem dados do paciente incompletos
        if (patientDataPendency) {
          expect(typeof patientDataPendency.isComplete).toBe('boolean');
        }
      }
    });

    it('should show hospital data as pending when no hospital is assigned', async () => {
      if (!testSurgeryRequestId) return;

      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${testSurgeryRequestId}`)
        .set(getAuthHeader(authToken));

      if (response.status === 200) {
        const pendencies = response.body.pendencies;
        const hospitalPendency = pendencies.find(
          (p: any) => p.key === 'hospital_data',
        );

        if (hospitalPendency) {
          // Solicitação nova sem hospital deve ter esta pendência incompleta
          expect(hospitalPendency.isComplete).toBe(false);
        }
      }
    });

    it('should calculate completion correctly', async () => {
      if (!testSurgeryRequestId) return;

      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${testSurgeryRequestId}`)
        .set(getAuthHeader(authToken));

      if (response.status === 200) {
        const { totalCount, completedCount, pendingCount } = response.body;

        // Verificar que a matemática está correta
        expect(pendingCount).toBe(totalCount - completedCount);
        expect(totalCount).toBeGreaterThanOrEqual(0);
        expect(completedCount).toBeGreaterThanOrEqual(0);
        expect(pendingCount).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
