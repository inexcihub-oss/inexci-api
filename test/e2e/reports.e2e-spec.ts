import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

const MEDICO = {
  name: 'Dr. Relatorios E2E',
  email: `dr.reports.${Date.now()}@inexci.test`,
  password: 'Senha@12345',
  phone: '11977770010',
  isDoctor: true,
  crm: 'CRM777001',
  crmState: 'SP',
  specialty: 'Cirurgia Geral',
};

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let tokenAdminSemMedicos: string;
  let tokenMedico: string;

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    const auth = await getAuthenticatedRequest(app);
    tokenAdminSemMedicos = auth.token;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(MEDICO)
      .expect(201);
    await prepararUsuarioParaLogin(app, MEDICO.email);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: MEDICO.email, password: MEDICO.password })
      .expect(201);
    tokenMedico = login.body.access_token;

    const paciente = await request(app.getHttpServer())
      .post('/patients')
      .set(getAuthHeader(tokenMedico))
      .send({
        name: 'Paciente Relatorios E2E',
        cpf: '12345678900',
        phone: '11999990000',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/surgery-requests')
      .set(getAuthHeader(tokenMedico))
      .send({ patientId: paciente.body.id, priority: 2 })
      .expect(201);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/reports/dashboard (GET)', () => {
    it('deve devolver os totais zerados quando a clínica não tem médicos', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(tokenAdminSemMedicos))
        .expect(200);

      expect(response.body).toEqual({
        surgeryRequest: {
          total: 0,
          totalScheduled: 0,
          totalPerformed: 0,
          totalInvoicedCount: 0,
          totalInvoicedValue: 0,
          totalReceivedValue: 0,
          totalByHealthPlan: [],
          totalByStatus: [],
          totalByHospital: [],
        },
      });
    });

    it('deve agregar a única SC da clínica do médico', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(tokenMedico))
        .expect(200);

      const { surgeryRequest } = response.body;

      expect(surgeryRequest.total).toBe(1);
      expect(surgeryRequest.totalScheduled).toBe(0);
      expect(surgeryRequest.totalPerformed).toBe(0);
      expect(surgeryRequest.totalInvoicedCount).toBe(0);
      expect(surgeryRequest.totalInvoicedValue).toBe(0);
      expect(surgeryRequest.totalReceivedValue).toBe(0);

      expect(surgeryRequest.totalByStatus).toEqual([{ status: 1, total: 1 }]);
      expect(surgeryRequest.totalByHospital).toEqual([
        { hospitalId: null, hospitalName: 'Sem Hospital', total: 1 },
      ]);
      expect(surgeryRequest.totalByHealthPlan).toEqual([
        { healthPlanId: null, healthPlanName: 'Sem Convênio', total: 1 },
      ]);
    });

    it('deve responder dentro do orçamento de tempo', async () => {
      const inicio = Date.now();
      await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set(getAuthHeader(tokenMedico))
        .expect(200);
      expect(Date.now() - inicio).toBeLessThan(10000);
    });

    it('deve recusar sem autenticação', async () => {
      await request(app.getHttpServer()).get('/reports/dashboard').expect(401);
    });

    it('deve recusar com token inválido', async () => {
      await request(app.getHttpServer())
        .get('/reports/dashboard')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/reports/pending-notifications (GET)', () => {
    it('deve devolver zero pendências para uma SC recém-criada', async () => {
      const response = await request(app.getHttpServer())
        .get('/reports/pending-notifications')
        .set(getAuthHeader(tokenMedico))
        .expect(200);

      expect(response.body).toEqual({
        total: 0,
        pendingAnalysis: 0,
        pendingScheduling: 0,
      });
    });

    it('deve recusar sem autenticação', async () => {
      await request(app.getHttpServer())
        .get('/reports/pending-notifications')
        .expect(401);
    });

    it('deve recusar com token inválido', async () => {
      await request(app.getHttpServer())
        .get('/reports/pending-notifications')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});
