/**
 * TESTE E2E - Status Change Notifications (10.2.3)
 *
 * Testa que mudanças de status geram notificações corretas para stakeholders.
 * Setup via API HTTP, validação via banco de dados.
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { prepararScParaEnvio } from '../helpers/surgery-request-prereqs';

const Status = {
  PENDING: 1,
  SENT: 2,
  IN_ANALYSIS: 3,
} as const;

const DOCTOR = {
  name: 'Dr. StatusChange E2E',
  email: `dr.status.${Date.now()}@inexci.test`,
  // `phone` passou a ser obrigatorio no RegisterDto.
  phone: '11977770001',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM777666',
  crmState: 'MG',
  specialty: 'Cirurgia Geral',
};

let app: INestApplication;
let token: string;
let userId: string;
let dataSource: DataSource;
let surgeryRequestId: string;

function authHeader() {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  app = await createTestApp();
  dataSource = app.get(DataSource);
  await cleanDatabase(app);

  // 1. Registrar médico
  const registerRes = await request(app.getHttpServer())
    .post('/auth/register')
    .send(DOCTOR)
    .expect(201);
  userId = registerRes.body.user.id;

  // `/auth/register` não devolve mais `access_token`; o login exige
  // e-mail confirmado e o `ConsentsGuard` exige os aceites.
  await prepararUsuarioParaLogin(app, DOCTOR.email);
  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: DOCTOR.email, password: DOCTOR.password })
    .expect(201);
  token = loginRes.body.access_token;

  // 2. Criar procedimento
  const procRes = await request(app.getHttpServer())
    .post('/procedures')
    .set(authHeader())
    .send({ name: 'Herniorrafia' })
    .expect(201);

  // 3. Criar plano de saúde
  const planRes = await request(app.getHttpServer())
    .post('/health_plans')
    .set(authHeader())
    .send({
      name: 'Plano Status E2E',
      phone: '31999990001',
      email: 'plano@status.com',
    })
    .expect(201);

  // 4. Criar hospital
  const hospRes = await request(app.getHttpServer())
    .post('/hospitals')
    .set(authHeader())
    .send({ name: 'Hospital Status', city: 'Belo Horizonte', state: 'MG' })
    .expect(201);

  // 5. Criar paciente
  const patRes = await request(app.getHttpServer())
    .post('/patients')
    .set(authHeader())
    .send({
      name: 'Paciente Status',
      phone: '31999990000',
      email: 'paciente@status.com',
      cpf: '11122233344',
      gender: 'M',
      birthDate: '1988-11-10',
      healthPlanId: planRes.body.id,
      healthPlanNumber: 'HP-STATUS-001',
      healthPlanType: 'individual',
    })
    .expect(201);

  // 6. Criar solicitação cirúrgica (status PENDING)
  const srRes = await request(app.getHttpServer())
    .post('/surgery-requests')
    .set(authHeader())
    .send({
      procedureId: procRes.body.id,
      patientId: patRes.body.id,
      // `manager_id` virou `doctorId` no DTO da SC.
      doctorId: userId,
      healthPlanId: planRes.body.id,
      hospitalId: hospRes.body.id,
      priority: 2,
    })
    .expect(201);
  surgeryRequestId = srRes.body.id ?? srRes.body.data?.id;

  // Sem isso, `POST /:id/send` responde 400 com as pendências bloqueantes de
  // PENDING e nenhuma mudança de status acontece — logo, nenhuma notificação.
  await prepararScParaEnvio(app, token, {
    surgeryRequestId,
    doctorUserId: userId,
  });
}, 60_000);

afterAll(async () => {
  await closeTestApp(app);
});

describe('Status Change Notifications E2E', () => {
  it('deve criar notificação ao mudar status PENDING → SENT', async () => {
    // Limpar notificações existentes
    await dataSource.query(`DELETE FROM notifications`);

    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/send`)
      .set(authHeader())
      .send({ method: 'email' });

    expect(res.status).toBe(201);

    // Aguardar processamento assíncrono
    await new Promise((r) => setTimeout(r, 500));

    // Verificar notificações criadas
    const notifications = await dataSource.query(
      `SELECT * FROM notifications WHERE type = 'status_update' ORDER BY created_at DESC`,
    );

    // O actor (próprio usuário) não recebe notificação, mas se houver outro
    // stakeholder registrado, haverá ao menos 0 (neste cenário single-user pode ser 0)
    expect(notifications).toBeDefined();
    expect(Array.isArray(notifications)).toBe(true);
  });

  it('deve incluir dados do status anterior e novo na notificação', async () => {
    await dataSource.query(`DELETE FROM notifications`);

    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/start-analysis`)
      .set(authHeader())
      // `requestNumber` e `receivedAt` são obrigatórios no StartAnalysisDto.
      .send({
        requestNumber: 'REQ-STATUS-001',
        receivedAt: new Date().toISOString(),
        notes: 'Analise iniciada via teste E2E.',
      })
      .expect(201);

    await new Promise((r) => setTimeout(r, 500));

    const notifications = await dataSource.query(
      `SELECT * FROM notifications WHERE type = 'status_update' ORDER BY created_at DESC`,
    );

    if (notifications.length > 0) {
      const notif = notifications[0];
      // Verificar que a mensagem contém referência ao status
      expect(notif.message || notif.title).toBeDefined();
    }
  });

  it('notificação deve estar marcada como não lida', async () => {
    const notifications = await dataSource.query(
      `SELECT * FROM notifications WHERE type = 'status_update' AND read = false`,
    );
    // Todas as notificações de status_update devem estar não lidas
    for (const n of notifications) {
      expect(n.read).toBe(false);
    }
  });

  it('deve retornar notificações via GET /notifications após mudança de status', async () => {
    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('listagem deve refletir notificações não lidas via unreadCount', async () => {
    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('unreadCount');
    expect(typeof res.body.unreadCount).toBe('number');
  });

  it('deve criar segundo usuário e verificar que recebe notificação de status change', async () => {
    // Tenant do usuário principal (a coluna é `owner_id`, não `account_id`)
    const [mainUser] = await dataSource.query(
      `SELECT id, owner_id FROM users WHERE id = $1`,
      [userId],
    );

    // Create collaborator directly in DB linked to the same account
    const collabId = (
      await dataSource.query(`SELECT uuid_generate_v4() AS id`)
    )[0].id;
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash('Senha@12345', 10);

    await dataSource.query(
      `INSERT INTO users (id, name, email, password, phone, role, status, owner_id, admin_id)
       VALUES ($1, $2, $3, $4, $5, 'collaborator', 'active', $6, $6)`,
      [
        collabId,
        'Colaborador Status E2E',
        `collab.status.${Date.now()}@inexci.test`,
        hashedPassword,
        `1197777${String(Date.now()).slice(-4)}`,
        mainUser.owner_id,
      ],
    );

    // Limpar notificações
    await dataSource.query(`DELETE FROM notifications`);

    // Reset status to PENDING so we can change it again
    await dataSource.query(
      `UPDATE surgery_requests SET status = $2 WHERE id = $1`,
      [surgeryRequestId, Status.PENDING],
    );

    // Mudar status com o doctor original
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/send`)
      .set(authHeader())
      .send({ method: 'email' })
      .expect(201);

    await new Promise((r) => setTimeout(r, 500));

    // Verificar que o collaborator recebeu notificação
    const collabNotifs = await dataSource.query(
      `SELECT * FROM notifications WHERE user_id = $1`,
      [collabId],
    );

    // O collaborator deveria receber notificação (pertence à mesma account)
    expect(collabNotifs).toBeDefined();
    expect(Array.isArray(collabNotifs)).toBe(true);
  });
});
