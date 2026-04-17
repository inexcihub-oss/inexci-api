/**
 * TESTE E2E - Stale Notifications (10.2.2)
 *
 * Testa o serviço de notificações de solicitações paradas (stale).
 * Cria dados via API e manipula datas no banco para simular cenários stale.
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';

const DOCTOR = {
  name: 'Dr. Stale E2E',
  email: `dr.stale.${Date.now()}@inexci.test`,
  password: 'Senha@12345',
  is_doctor: true,
  crm: 'CRM999888',
  crm_state: 'RJ',
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

  // 1. Registrar médico
  const registerRes = await request(app.getHttpServer())
    .post('/auth/register')
    .send(DOCTOR)
    .expect(201);
  token = registerRes.body.access_token;
  userId = registerRes.body.user.id;

  // 2. Criar procedimento
  const procRes = await request(app.getHttpServer())
    .post('/procedures')
    .set(authHeader())
    .send({ name: 'Artroscopia Joelho' })
    .expect(201);

  // 3. Criar plano de saúde
  const planRes = await request(app.getHttpServer())
    .post('/health_plans')
    .set(authHeader())
    .send({
      name: 'Plano Stale E2E',
      phone: '21999990001',
      email: 'plano@stale.com',
      default_payment_days: 30,
    })
    .expect(201);

  // 4. Criar hospital
  const hospRes = await request(app.getHttpServer())
    .post('/hospitals')
    .set(authHeader())
    .send({ name: 'Hospital Stale', city: 'Rio de Janeiro', state: 'RJ' })
    .expect(201);

  // 5. Criar paciente
  const patRes = await request(app.getHttpServer())
    .post('/patients')
    .set(authHeader())
    .send({
      name: 'Paciente Stale',
      phone: '21999990000',
      email: 'paciente@stale.com',
      cpf: '98765432100',
      gender: 'F',
      birth_date: '1990-03-20',
      health_plan_id: planRes.body.id,
      health_plan_number: 'HP-STALE-001',
      health_plan_type: 'individual',
    })
    .expect(201);

  // 6. Criar solicitação cirúrgica
  const srRes = await request(app.getHttpServer())
    .post('/surgery-requests')
    .set(authHeader())
    .send({
      procedure_id: procRes.body.id,
      patient_id: patRes.body.id,
      manager_id: userId,
      health_plan_id: planRes.body.id,
      hospital_id: hospRes.body.id,
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
    // Simular atualização há 4 dias atrás
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    await dataSource.query(
      `UPDATE surgery_request SET updated_at = $1, last_status_changed_at = $1 WHERE id = $2`,
      [fourDaysAgo.toISOString(), surgeryRequestId],
    );

    // Verify the data was set correctly
    const [sr] = await dataSource.query(
      `SELECT id, status, last_status_changed_at, created_by_id FROM surgery_request WHERE id = $1`,
      [surgeryRequestId],
    );
    expect(sr.last_status_changed_at).toBeDefined();

    // Check user has account_id
    const [user] = await dataSource.query(
      `SELECT id, account_id, role FROM "user" WHERE id = $1`,
      [sr.created_by_id],
    );
    expect(user.account_id).toBeDefined();

    const count = await staleService.checkAndNotifyStaleRequests();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('não deve duplicar notificação stale para o mesmo tier', async () => {
    // Rodar novamente — já foi notificado para tier de 3 dias
    const count = await staleService.checkAndNotifyStaleRequests();
    // Deve ser 0 pois já notificou neste tier
    expect(count).toBe(0);
  });

  it('deve gerar nova notificação para tier superior (7 dias)', async () => {
    // Simular atualização há 8 dias atrás
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    await dataSource.query(
      `UPDATE surgery_request SET updated_at = $1, last_status_changed_at = $1 WHERE id = $2`,
      [eightDaysAgo.toISOString(), surgeryRequestId],
    );

    const count = await staleService.checkAndNotifyStaleRequests();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('deve registrar log de stale notification para evitar duplicatas', async () => {
    const logs = await dataSource.query(
      `SELECT * FROM stale_notification_log WHERE surgery_request_id = $1`,
      [surgeryRequestId],
    );
    expect(logs.length).toBeGreaterThanOrEqual(1); // at least one tier logged
  });
});
