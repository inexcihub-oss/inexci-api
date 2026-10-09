import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';

const DOCTOR = {
  name: 'Dr. Stale E2E',
  email: `dr.stale.${Date.now()}@inexci.test`,
  phone: '11977770002',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM999888',
  crmState: 'RJ',
  specialty: 'Ortopedia',
};

let app: INestApplication;
let token: string;
let userId: string;
let dataSource: DataSource;
let staleService: StaleNotificationService;
let surgeryRequestId: string;

function authHeader() {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  app = await createTestApp();
  dataSource = app.get(DataSource);
  staleService = app.get(StaleNotificationService);

  await cleanDatabase(app);

  const registerRes = await request(app.getHttpServer())
    .post('/auth/register')
    .send(DOCTOR)
    .expect(201);
  userId = registerRes.body.user.id;

  await prepararUsuarioParaLogin(app, DOCTOR.email);
  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: DOCTOR.email, password: DOCTOR.password })
    .expect(201);
  token = loginRes.body.access_token;

  const procRes = await request(app.getHttpServer())
    .post('/procedures')
    .set(authHeader())
    .send({ name: 'Artroscopia Joelho' })
    .expect(201);

  const planRes = await request(app.getHttpServer())
    .post('/health_plans')
    .set(authHeader())
    .send({
      name: 'Plano Stale E2E',
      phone: '21999990001',
      email: 'plano@stale.com',
    })
    .expect(201);

  const hospRes = await request(app.getHttpServer())
    .post('/hospitals')
    .set(authHeader())
    .send({ name: 'Hospital Stale', city: 'Rio de Janeiro', state: 'RJ' })
    .expect(201);

  const patRes = await request(app.getHttpServer())
    .post('/patients')
    .set(authHeader())
    .send({
      name: 'Paciente Stale',
      phone: '21999990000',
      email: 'paciente@stale.com',
      cpf: '98765432100',
      gender: 'F',
      birthDate: '1990-03-20',
      healthPlanId: planRes.body.id,
      healthPlanNumber: 'HP-STALE-001',
      healthPlanType: 'individual',
    })
    .expect(201);

  const srRes = await request(app.getHttpServer())
    .post('/surgery-requests')
    .set(authHeader())
    .send({
      procedureId: procRes.body.id,
      patientId: patRes.body.id,
      doctorId: userId,
      healthPlanId: planRes.body.id,
      hospitalId: hospRes.body.id,
      priority: 2,
    })
    .expect(201);
  surgeryRequestId = srRes.body.id ?? srRes.body.data?.id;
}, 60_000);

afterAll(async () => {
  await closeTestApp(app);
});

describe('Stale Notifications E2E', () => {
  it('não deve gerar notificações stale para solicitação recente (< 3 dias)', async () => {
    const count = await staleService.checkAndNotifyStaleRequests();
    expect(count).toBe(0);
  });

  it('deve gerar notificação stale quando solicitação está parada há 4 dias', async () => {
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    await dataSource.query(
      `UPDATE surgery_requests SET updated_at = $1, last_status_changed_at = $1 WHERE id = $2`,
      [fourDaysAgo.toISOString(), surgeryRequestId],
    );

    const [sr] = await dataSource.query(
      `SELECT id, status, last_status_changed_at, created_by_id FROM surgery_requests WHERE id = $1`,
      [surgeryRequestId],
    );
    expect(sr.last_status_changed_at).toBeDefined();

    const [user] = await dataSource.query(
      `SELECT id, owner_id, role FROM users WHERE id = $1`,
      [sr.created_by_id],
    );
    expect(user.owner_id).toBeDefined();

    const count = await staleService.checkAndNotifyStaleRequests();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('não deve duplicar notificação stale para o mesmo tier', async () => {
    const count = await staleService.checkAndNotifyStaleRequests();
    expect(count).toBe(0);
  });

  it('deve gerar nova notificação para tier superior (7 dias)', async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    await dataSource.query(
      `UPDATE surgery_requests SET updated_at = $1, last_status_changed_at = $1 WHERE id = $2`,
      [eightDaysAgo.toISOString(), surgeryRequestId],
    );

    const count = await staleService.checkAndNotifyStaleRequests();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('deve registrar log de stale notification para evitar duplicatas', async () => {
    const logs = await dataSource.query(
      `SELECT * FROM stale_notification_logs WHERE surgery_request_id = $1`,
      [surgeryRequestId],
    );
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
