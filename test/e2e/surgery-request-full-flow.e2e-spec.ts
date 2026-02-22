/**
 * TESTE E2E - FLUXO COMPLETO DE SOLICITACAO CIRURGICA
 *
 * Setup feito exclusivamente via rotas HTTP da API (sem SQL direto).
 * Fluxo: PENDING -> SENT -> IN_ANALYSIS -> IN_SCHEDULING -> SCHEDULED
 *        -> PERFORMED -> INVOICED -> FINALIZED
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';

const Status = {
  PENDING: 1,
  SENT: 2,
  IN_ANALYSIS: 3,
  IN_SCHEDULING: 4,
  SCHEDULED: 5,
  PERFORMED: 6,
  INVOICED: 7,
  FINALIZED: 8,
  CLOSED: 9,
} as const;

const STATUS_LABEL: Record<number, string> = {
  1: 'PENDING',
  2: 'SENT',
  3: 'IN_ANALYSIS',
  4: 'IN_SCHEDULING',
  5: 'SCHEDULED',
  6: 'PERFORMED',
  7: 'INVOICED',
  8: 'FINALIZED',
  9: 'CLOSED',
};

const DOCTOR = {
  name: 'Dr. Teste Fluxo E2E',
  email: `dr.e2e.flow.${Date.now()}@inexci.test`,
  password: 'Senha@12345',
};

let app: INestApplication;
let token: string;
let userId: string;
let surgeryRequestId: string;

function authHeader() {
  return { Authorization: `Bearer ${token}` };
}

async function fetchSurgeryRequest(id: string) {
  const res = await request(app.getHttpServer())
    .get('/surgery-requests/one')
    .query({ id })
    .set(authHeader())
    .expect(200);
  return res.body;
}

async function assertStatus(id: string, expected: number): Promise<void> {
  const body = await fetchSurgeryRequest(id);
  const actual = body?.status ?? body?.data?.status;
  expect(actual).toBe(expected);
}

// ----------------------------------------------------------------
// Setup global - todos os pre-requisitos via API
// ----------------------------------------------------------------

beforeAll(async () => {
  app = await createTestApp();
  await cleanDatabase(app);

  // 1. Registrar medico
  const registerRes = await request(app.getHttpServer())
    .post('/auth/register')
    .send(DOCTOR)
    .expect(201);
  token = registerRes.body.access_token;
  userId = registerRes.body.user.id;
  expect(token).toBeDefined();
  expect(userId).toBeDefined();

  // 2. Criar perfil de medico
  await request(app.getHttpServer())
    .post('/users/doctor-profile')
    .set(authHeader())
    .send({ specialty: 'Cirurgia Geral', crm: 'CRM123456', crm_state: 'SP' })
    .expect(201);

  // 3. Criar procedimento
  const procedureRes = await request(app.getHttpServer())
    .post('/procedures')
    .set(authHeader())
    .send({ name: 'Colecistectomia Laparoscopica', tuss_code: '31303029' })
    .expect(201);
  const procedureId: string = procedureRes.body.id;
  expect(procedureId).toBeDefined();

  // 4. Criar plano de saude
  const healthPlanRes = await request(app.getHttpServer())
    .post('/health_plans')
    .set(authHeader())
    .send({ name: 'Plano Saude E2E', default_payment_days: 30 })
    .expect(201);
  const healthPlanId: string = healthPlanRes.body.id;
  expect(healthPlanId).toBeDefined();

  // 5. Criar hospital
  const hospitalRes = await request(app.getHttpServer())
    .post('/hospitals')
    .set(authHeader())
    .send({ name: 'Hospital E2E', city: 'Sao Paulo', state: 'SP' })
    .expect(201);
  const hospitalId: string = hospitalRes.body.id;
  expect(hospitalId).toBeDefined();

  // 6. Criar paciente
  const patientRes = await request(app.getHttpServer())
    .post('/patients')
    .set(authHeader())
    .send({
      name: 'Paciente Teste E2E',
      phone: '11999990000',
      cpf: '123.456.789-00',
      gender: 'M',
      birth_date: '1985-06-15',
      health_plan_id: healthPlanId,
      health_plan_number: 'HP-001-E2E',
      health_plan_type: 'individual',
    })
    .expect(201);
  const patientId: string = patientRes.body.id;
  expect(patientId).toBeDefined();

  // 7. Criar solicitacao cirurgica
  const srRes = await request(app.getHttpServer())
    .post('/surgery-requests')
    .set(authHeader())
    .send({
      procedure_id: procedureId,
      patient_id: patientId,
      manager_id: userId,
      health_plan_id: healthPlanId,
      hospital_id: hospitalId,
      priority: 2,
    })
    .expect(201);
  surgeryRequestId = srRes.body.id ?? srRes.body.data?.id;
  expect(surgeryRequestId).toBeDefined();
}, 60_000);

afterAll(async () => {
  await closeTestApp(app);
});

// ----------------------------------------------------------------
// 1. Status PENDING (criacao)
// ----------------------------------------------------------------

describe('1. Criacao - Status PENDING (1)', () => {
  it('deve ter status PENDING apos criacao', async () => {
    await assertStatus(surgeryRequestId, Status.PENDING);
  });

  it('deve ter priority = 2 (MEDIUM)', async () => {
    const sr = await fetchSurgeryRequest(surgeryRequestId);
    expect((sr?.data ?? sr).priority).toBe(2);
  });
});

// ----------------------------------------------------------------
// 2. PENDING -> SENT
// ----------------------------------------------------------------

describe('2. Transicao PENDING -> SENT (2)', () => {
  it('deve enviar a solicitacao (method email sem destinatario)', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/send`)
      .set(authHeader())
      .send({ method: 'email' })
      .expect(201);
  });

  it('deve confirmar status SENT apos envio', async () => {
    await assertStatus(surgeryRequestId, Status.SENT);
  });

  it('nao deve permitir reenvio (ja esta SENT)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/send`)
      .set(authHeader())
      .send({ method: 'email' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ----------------------------------------------------------------
// 3. SENT -> IN_ANALYSIS
// ----------------------------------------------------------------

describe('3. Transicao SENT -> IN_ANALYSIS (3)', () => {
  it('deve registrar o inicio da analise', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/start-analysis`)
      .set(authHeader())
      .send({
        request_number: 'REQ-2026-001',
        received_at: new Date().toISOString(),
        notes: 'Analise iniciada via teste E2E.',
      })
      .expect(201);
  });

  it('deve confirmar status IN_ANALYSIS', async () => {
    await assertStatus(surgeryRequestId, Status.IN_ANALYSIS);
  });
});

// ----------------------------------------------------------------
// 4. IN_ANALYSIS -> IN_SCHEDULING
// ----------------------------------------------------------------

describe('4. Transicao IN_ANALYSIS -> IN_SCHEDULING (4)', () => {
  it('deve aceitar autorizacao com 3 opcoes de data', async () => {
    const today = new Date();
    const d = (n: number) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + n);
      return dt.toISOString().split('T')[0];
    };
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/accept-authorization`)
      .set(authHeader())
      .send({ date_options: [d(7), d(14), d(21)] })
      .expect(201);
  });

  it('deve confirmar status IN_SCHEDULING', async () => {
    await assertStatus(surgeryRequestId, Status.IN_SCHEDULING);
  });

  it('nao deve aceitar date_options vazio', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/accept-authorization`)
      .set(authHeader())
      .send({ date_options: [] });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ----------------------------------------------------------------
// 5. IN_SCHEDULING -> SCHEDULED
// ----------------------------------------------------------------

describe('5. Transicao IN_SCHEDULING -> SCHEDULED (5)', () => {
  it('deve confirmar a data escolhida (indice 0)', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/confirm-date`)
      .set(authHeader())
      .send({ selected_date_index: 0 })
      .expect(201);
  });

  it('deve confirmar status SCHEDULED', async () => {
    await assertStatus(surgeryRequestId, Status.SCHEDULED);
  });
});

// ----------------------------------------------------------------
// 6. SCHEDULED -> PERFORMED
// ----------------------------------------------------------------

describe('6. Transicao SCHEDULED -> PERFORMED (6)', () => {
  it('deve marcar a cirurgia como realizada', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/mark-performed`)
      .set(authHeader())
      .send({ surgery_performed_at: new Date().toISOString() })
      .expect(201);
  });

  it('deve confirmar status PERFORMED', async () => {
    await assertStatus(surgeryRequestId, Status.PERFORMED);
  });
});

// ----------------------------------------------------------------
// 7. PERFORMED -> INVOICED
// ----------------------------------------------------------------

describe('7. Transicao PERFORMED -> INVOICED (7)', () => {
  it('deve registrar o faturamento', async () => {
    const sentAt = new Date();
    const deadline = new Date(sentAt);
    deadline.setDate(deadline.getDate() + 30);
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/invoice`)
      .set(authHeader())
      .send({
        invoice_protocol: 'NF-2026-00123',
        invoice_sent_at: sentAt.toISOString(),
        invoice_value: 4500.0,
        payment_deadline: deadline.toISOString().split('T')[0],
        set_as_default_for_health_plan: false,
      })
      .expect(201);
  });

  it('deve confirmar status INVOICED', async () => {
    await assertStatus(surgeryRequestId, Status.INVOICED);
  });
});

// ----------------------------------------------------------------
// 8. INVOICED -> FINALIZED
// ----------------------------------------------------------------

describe('8. Transicao INVOICED -> FINALIZED (8)', () => {
  it('deve confirmar o recebimento do pagamento', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/confirm-receipt`)
      .set(authHeader())
      .send({
        received_value: 4500.0,
        received_at: new Date().toISOString(),
        receipt_notes: 'Pagamento recebido integralmente via teste E2E.',
      })
      .expect(201);
  });

  it('deve confirmar status FINALIZED', async () => {
    await assertStatus(surgeryRequestId, Status.FINALIZED);
  });
});

// ----------------------------------------------------------------
// 9. Verificacao final
// ----------------------------------------------------------------

describe('9. Verificacao final do fluxo', () => {
  it('a solicitacao deve estar FINALIZED ao final', async () => {
    const sr = await fetchSurgeryRequest(surgeryRequestId);
    const data = sr?.data ?? sr;
    expect(data.status).toBe(Status.FINALIZED);
    console.log(
      `Fluxo completo! ID=${surgeryRequestId} Status=${STATUS_LABEL[data.status]}(${data.status})`,
    );
  });
});

// ----------------------------------------------------------------
// 10. Protecao de maquina de estados
// ----------------------------------------------------------------

describe('10. Protecao de maquina de estados (transicoes invalidas)', () => {
  it('nao deve aceitar send em FINALIZED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/send`)
      .set(authHeader())
      .send({ method: 'email' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('nao deve aceitar start-analysis em FINALIZED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/start-analysis`)
      .set(authHeader())
      .send({ request_number: 'REQ-X', received_at: new Date().toISOString() });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('nao deve aceitar mark-performed em FINALIZED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/mark-performed`)
      .set(authHeader())
      .send({ surgery_performed_at: new Date().toISOString() });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('nao deve permitir acesso sem autenticacao', async () => {
    await request(app.getHttpServer())
      .get('/surgery-requests/one')
      .query({ id: surgeryRequestId })
      .expect(401);
  });
});
