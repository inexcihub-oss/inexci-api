import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { prepararScParaEnvio } from '../helpers/surgery-request-prereqs';

const MEDICO = {
  name: 'Dr. Pendencias E2E',
  email: `dr.pendencias.${Date.now()}@inexci.test`,
  password: 'Senha@12345',
  phone: '11977770020',
  isDoctor: true,
  crm: 'CRM777020',
  crmState: 'SP',
  specialty: 'Cirurgia Geral',
};

const PENDENCIAS_PENDING = [
  'patient_data',
  'hospital_data',
  'tuss_procedures',
  'opme_items',
  'medical_report',
];

describe('Pendencies (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let medicoUserId: string;
  let scCrua: string;
  let scPronta: string;

  function authHeader() {
    return { Authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    const registro = await request(app.getHttpServer())
      .post('/auth/register')
      .send(MEDICO)
      .expect(201);
    medicoUserId = registro.body.user.id;

    await prepararUsuarioParaLogin(app, MEDICO.email);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: MEDICO.email, password: MEDICO.password })
      .expect(201);
    token = login.body.access_token;

    const paciente = await request(app.getHttpServer())
      .post('/patients')
      .set(authHeader())
      .send({
        name: 'Paciente Pendencias E2E',
        cpf: '12345678900',
        phone: '11999990020',
      })
      .expect(201);

    const hospital = await request(app.getHttpServer())
      .post('/hospitals')
      .set(authHeader())
      .send({ name: 'Hospital Pendencias', city: 'Sao Paulo', state: 'SP' })
      .expect(201);

    const cruaRes = await request(app.getHttpServer())
      .post('/surgery-requests')
      .set(authHeader())
      .send({ patientId: paciente.body.id, priority: 2 })
      .expect(201);
    scCrua = cruaRes.body.id;

    const prontaRes = await request(app.getHttpServer())
      .post('/surgery-requests')
      .set(authHeader())
      .send({
        patientId: paciente.body.id,
        hospitalId: hospital.body.id,
        priority: 2,
      })
      .expect(201);
    scPronta = prontaRes.body.id;

    await prepararScParaEnvio(app, token, {
      surgeryRequestId: scPronta,
      doctorUserId: medicoUserId,
    });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/pendencies/validate/:surgeryRequestId (GET)', () => {
    it('deve listar as 5 pendências de PENDING com o estado real de cada uma', async () => {
      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${scCrua}`)
        .set(authHeader())
        .expect(200);

      expect(response.body.currentStatus).toBe(1);
      expect(response.body.statusLabel).toBe('Pendente');
      expect(response.body.nextStatus).toBe(2);

      expect(response.body.pendencies.map((p: any) => p.key)).toEqual(
        PENDENCIAS_PENDING,
      );

      const porChave = Object.fromEntries(
        response.body.pendencies.map((p: any) => [p.key, p]),
      );
      expect(porChave.patient_data.isComplete).toBe(true);
      expect(porChave.hospital_data.isComplete).toBe(false);
      expect(porChave.tuss_procedures.isComplete).toBe(false);
      expect(porChave.opme_items.isComplete).toBe(false);
      expect(porChave.medical_report.isComplete).toBe(false);

      expect(
        response.body.pendencies.every((p: any) => p.isOptional === false),
      ).toBe(true);
      expect(porChave.medical_report.responsible).toBe('doctor');
      expect(porChave.hospital_data.responsible).toBe('collaborator');

      expect(response.body.totalCount).toBe(5);
      expect(response.body.completedCount).toBe(1);
      expect(response.body.pendingCount).toBe(4);
      expect(response.body.canAdvance).toBe(false);
    });

    it('deve devolver os checkItems de cada pendência', async () => {
      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${scCrua}`)
        .set(authHeader())
        .expect(200);

      const porChave = Object.fromEntries(
        response.body.pendencies.map((p: any) => [p.key, p]),
      );

      expect(porChave.patient_data.checkItems).toEqual([
        { label: 'Nome do paciente', done: true },
        { label: 'CPF', done: true },
      ]);
      expect(porChave.hospital_data.checkItems).toEqual([
        { label: 'Hospital selecionado', done: false },
      ]);
      expect(porChave.opme_items.checkItems).toEqual([
        { label: 'Indicar se há ou não OPME nesta solicitação', done: false },
      ]);
    });

    it('deve liberar o avanço quando as 5 pendências estão resolvidas', async () => {
      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${scPronta}`)
        .set(authHeader())
        .expect(200);

      expect(response.body.totalCount).toBe(5);
      expect(response.body.completedCount).toBe(5);
      expect(response.body.pendingCount).toBe(0);
      expect(response.body.canAdvance).toBe(true);
      expect(
        response.body.pendencies.every((p: any) => p.isComplete === true),
      ).toBe(true);
    });

    it('deve responder 404 para uma SC inexistente', async () => {
      await request(app.getHttpServer())
        .get(
          '/surgery-requests/pendencies/validate/00000000-0000-4000-8000-000000000000',
        )
        .set(authHeader())
        .expect(404);
    });

    it('deve responder 404 para um id que não é UUID', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/validate/1')
        .set(authHeader())
        .expect(404);
    });

    it('deve recusar sem autenticação', async () => {
      await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${scCrua}`)
        .expect(401);
    });

    it('deve recusar com token inválido', async () => {
      await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/validate/${scCrua}`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/surgery-requests/pendencies/summary/:surgeryRequestId (GET)', () => {
    it('deve resumir as pendências bloqueantes em aberto', async () => {
      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/summary/${scCrua}`)
        .set(authHeader())
        .expect(200);

      expect(response.body.pending).toBe(4);
      expect(response.body.total).toBe(5);
      expect(response.body.canAdvance).toBe(false);
      expect(response.body.items.map((i: any) => i.key)).toEqual(
        PENDENCIAS_PENDING,
      );
      expect(response.body.items.map((i: any) => [i.key, i.resolved])).toEqual([
        ['patient_data', true],
        ['hospital_data', false],
        ['tuss_procedures', false],
        ['opme_items', false],
        ['medical_report', false],
      ]);
    });

    it('deve zerar as pendências da SC pronta', async () => {
      const response = await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/summary/${scPronta}`)
        .set(authHeader())
        .expect(200);

      expect(response.body.pending).toBe(0);
      expect(response.body.total).toBe(5);
      expect(response.body.canAdvance).toBe(true);
    });

    it('deve recusar sem autenticação', async () => {
      await request(app.getHttpServer())
        .get(`/surgery-requests/pendencies/summary/${scCrua}`)
        .expect(401);
    });
  });

  describe('/surgery-requests/pendencies/batch-summary (GET)', () => {
    it('deve resumir várias SCs numa chamada só', async () => {
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/batch-summary')
        .query({ ids: `${scCrua},${scPronta}` })
        .set(authHeader())
        .expect(200);

      expect(response.body).toEqual({
        [scCrua]: { pending: 4, total: 5, canAdvance: false },
        [scPronta]: { pending: 0, total: 5, canAdvance: true },
      });
    });

    it('deve devolver o default fail-closed para id que não carrega', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      const response = await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/batch-summary')
        .query({ ids: `${scCrua},${inexistente}` })
        .set(authHeader())
        .expect(200);

      expect(response.body[scCrua]).toEqual({
        pending: 4,
        total: 5,
        canAdvance: false,
      });
      expect(response.body[inexistente]).toEqual({
        pending: 0,
        total: 0,
        canAdvance: false,
      });
    });

    it('deve recusar sem autenticação', async () => {
      await request(app.getHttpServer())
        .get('/surgery-requests/pendencies/batch-summary')
        .query({ ids: scCrua })
        .expect(401);
    });
  });
});
