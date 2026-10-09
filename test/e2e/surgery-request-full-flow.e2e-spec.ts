import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import {
  configurarAssinaturaDoMedico,
  declararSemOpme,
} from '../helpers/surgery-request-prereqs';

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
  phone: '11977770003',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM123456',
  crmState: 'SP',
  specialty: 'Cirurgia Geral',
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

beforeAll(async () => {
  app = await createTestApp();
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
  expect(token).toBeDefined();
  expect(userId).toBeDefined();

  const procedureRes = await request(app.getHttpServer())
    .post('/procedures')
    .set(authHeader())
    .send({ name: 'Colecistectomia Laparoscopica' })
    .expect(201);
  const procedureId: string = procedureRes.body.id;
  expect(procedureId).toBeDefined();

  const healthPlanRes = await request(app.getHttpServer())
    .post('/health_plans')
    .set(authHeader())
    .send({
      name: 'Plano Saude E2E',
      phone: '11999990001',
      email: 'plano@e2e.com',
    })
    .expect(201);
  const healthPlanId: string = healthPlanRes.body.id;
  expect(healthPlanId).toBeDefined();

  const hospitalRes = await request(app.getHttpServer())
    .post('/hospitals')
    .set(authHeader())
    .send({ name: 'Hospital E2E', city: 'Sao Paulo', state: 'SP' })
    .expect(201);
  const hospitalId: string = hospitalRes.body.id;
  expect(hospitalId).toBeDefined();

  const patientRes = await request(app.getHttpServer())
    .post('/patients')
    .set(authHeader())
    .send({
      name: 'Paciente Teste E2E',
      phone: '11999990000',
      email: 'paciente@e2e.com',
      cpf: '12345678900',
      gender: 'M',
      birthDate: '1985-06-15',
      healthPlanId: healthPlanId,
      healthPlanNumber: 'HP-001-E2E',
      healthPlanType: 'individual',
    })
    .expect(201);
  const patientId: string = patientRes.body.id;
  expect(patientId).toBeDefined();

  const srRes = await request(app.getHttpServer())
    .post('/surgery-requests')
    .set(authHeader())
    .send({
      procedureId: procedureId,
      patientId: patientId,
      doctorId: userId,
      healthPlanId: healthPlanId,
      hospitalId: hospitalId,
      priority: 2,
    })
    .expect(201);
  surgeryRequestId = srRes.body.id ?? srRes.body.data?.id;
  expect(surgeryRequestId).toBeDefined();
}, 60_000);

afterAll(async () => {
  await closeTestApp(app);
});

describe('1. Criacao - Status PENDING (1)', () => {
  it('deve ter status PENDING apos criacao', async () => {
    await assertStatus(surgeryRequestId, Status.PENDING);
  });

  it('deve ter priority = 2 (MEDIUM)', async () => {
    const sr = await fetchSurgeryRequest(surgeryRequestId);
    expect((sr?.data ?? sr).priority).toBe(2);
  });
});

describe('2. Transicao PENDING -> SENT (2)', () => {
  it('deve declarar que a solicitacao nao usa OPME', async () => {
    await declararSemOpme(app, token, surgeryRequestId);
  });

  it('deve configurar a assinatura do medico', async () => {
    await configurarAssinaturaDoMedico(app, token, userId);
  });

  it('deve criar ao menos uma secao de laudo antes de enviar', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/sections`)
      .set(authHeader())
      .send({
        title: 'Indicação Cirúrgica',
        description:
          '<p>Paciente apresenta indicação para colecistectomia videolaparoscópica.</p>',
      })
      .expect(201);
  });

  it('deve adicionar ao menos um procedimento TUSS', async () => {
    await request(app.getHttpServer())
      .post('/surgery-requests/procedures')
      .set(authHeader())
      .send({
        surgeryRequestId: surgeryRequestId,
        procedures: [
          {
            tussCode: '30101012',
            name: 'Colecistectomia Videolaparoscópica',
            quantity: 1,
          },
        ],
      })
      .expect(201);
  });

  it('deve enviar a solicitacao (method email sem destinatario)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/send`)
      .set(authHeader())
      .send({ method: 'email' });
    if (res.status !== 201) {
      console.error('SEND ERROR:', res.status, JSON.stringify(res.body));
    }
    expect(res.status).toBe(201);
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

describe('3. Transicao SENT -> IN_ANALYSIS (3)', () => {
  it('deve registrar o inicio da analise', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/start-analysis`)
      .set(authHeader())
      .send({
        requestNumber: 'REQ-2026-001',
        receivedAt: new Date().toISOString(),
        notes: 'Analise iniciada via teste E2E.',
      })
      .expect(201);
  });

  it('deve confirmar status IN_ANALYSIS', async () => {
    await assertStatus(surgeryRequestId, Status.IN_ANALYSIS);
  });
});

describe('4. Transicao IN_ANALYSIS -> IN_SCHEDULING (4)', () => {
  it('deve aceitar autorizacao com 3 opcoes de data', async () => {
    const today = new Date();
    const d = (n: number) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + n);
      dt.setUTCHours(14, 30, 0, 0);
      return dt.toISOString();
    };
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/accept-authorization`)
      .set(authHeader())
      .send({ dateOptions: [d(7), d(14), d(21)] })
      .expect(201);
  });

  it('deve confirmar status IN_SCHEDULING', async () => {
    await assertStatus(surgeryRequestId, Status.IN_SCHEDULING);
  });

  it('nao deve aceitar data sem horario explicito', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/accept-authorization`)
      .set(authHeader())
      .send({ dateOptions: ['2030-01-15'] });
    expect(res.status).toBe(400);
  });
});

describe('5. Transicao IN_SCHEDULING -> SCHEDULED (5)', () => {
  it('deve confirmar a data escolhida (indice 0)', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/confirm-date`)
      .set(authHeader())
      .send({ selectedDateIndex: 0 })
      .expect(201);
  });

  it('deve confirmar status SCHEDULED', async () => {
    await assertStatus(surgeryRequestId, Status.SCHEDULED);
  });
});

describe('6. Transicao SCHEDULED -> PERFORMED (6)', () => {
  it('deve marcar a cirurgia como realizada', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/mark-performed`)
      .set(authHeader())
      .send({ surgeryPerformedAt: new Date().toISOString() })
      .expect(201);
  });

  it('deve confirmar status PERFORMED', async () => {
    await assertStatus(surgeryRequestId, Status.PERFORMED);
  });
});

describe('7. Transicao PERFORMED -> INVOICED (7)', () => {
  it('deve registrar o faturamento', async () => {
    const sentAt = new Date();
    const deadline = new Date(sentAt);
    deadline.setDate(deadline.getDate() + 30);
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/invoice`)
      .set(authHeader())
      .send({
        invoiceProtocol: 'NF-2026-00123',
        invoiceSentAt: sentAt.toISOString(),
        invoiceValue: 4500.0,
        paymentDeadline: deadline.toISOString().split('T')[0],
        setAsDefaultForHealthPlan: false,
      })
      .expect(201);
  });

  it('deve confirmar status INVOICED', async () => {
    await assertStatus(surgeryRequestId, Status.INVOICED);
  });
});

describe('8. Transicao INVOICED -> FINALIZED (8)', () => {
  it('deve confirmar o recebimento do pagamento', async () => {
    await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/confirm-receipt`)
      .set(authHeader())
      .send({
        receivedValue: 4500.0,
        receivedAt: new Date().toISOString(),
        receiptNotes: 'Pagamento recebido integralmente via teste E2E.',
      })
      .expect(201);
  });

  it('deve confirmar status FINALIZED', async () => {
    await assertStatus(surgeryRequestId, Status.FINALIZED);
  });
});

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
      .send({ requestNumber: 'REQ-X', receivedAt: new Date().toISOString() });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('nao deve aceitar mark-performed em FINALIZED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/surgery-requests/${surgeryRequestId}/mark-performed`)
      .set(authHeader())
      .send({ surgeryPerformedAt: new Date().toISOString() });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('nao deve permitir acesso sem autenticacao', async () => {
    await request(app.getHttpServer())
      .get('/surgery-requests/one')
      .query({ id: surgeryRequestId })
      .expect(401);
  });
});
