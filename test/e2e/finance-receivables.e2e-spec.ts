import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  cleanDatabase,
  closeTestApp,
  createTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';

const DONO = {
  name: 'Dr. Financeiro E2E',
  email: `dr.financeiro.${Date.now()}@inexci.test`,
  phone: '11966660101',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM778001',
  crmState: 'SP',
  specialty: 'Ortopedia',
};

const OUTRO = {
  name: 'Dra. Outra Conta E2E',
  email: `dra.outra.financeiro.${Date.now()}@inexci.test`,
  phone: '11966660102',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM778002',
  crmState: 'SP',
  specialty: 'Ortopedia',
};

describe('Financeiro — consulta → cobrança → pagamento dividido → estorno (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let outroToken: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;
  let bancoId: string;
  let stoneId: string;
  let caixaId: string;
  let receivableId: string;

  function auth(t = token) {
    return { Authorization: `Bearer ${t}` };
  }

  async function registrar(dados: typeof DONO) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(dados)
      .expect(201);
    await prepararUsuarioParaLogin(app, dados.email);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: dados.email, password: dados.password })
      .expect(201);
    return {
      userId: res.body.user.id as string,
      token: login.body.access_token as string,
    };
  }

  async function criarConta(name: string, type: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/finance/accounts')
      .set(auth())
      .send({ name, type })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    const dono = await registrar(DONO);
    token = dono.token;
    doctorId = dono.userId;
    outroToken = (await registrar(OUTRO)).token;

    const paciente = await request(app.getHttpServer())
      .post('/patients')
      .set(auth())
      .send({
        name: 'Paciente Financeiro E2E',
        phone: '11955550101',
        email: 'paciente.financeiro@e2e.test',
        cpf: '52998224725',
        gender: 'F',
        birthDate: '1985-02-10',
      })
      .expect(201);
    patientId = paciente.body.id;

    const consulta = await request(app.getHttpServer())
      .post('/appointments')
      .set(auth())
      .send({
        patientId,
        doctorId,
        scheduledAt: '2027-04-10T13:00:00.000Z',
        price: '300.00',
      })
      .expect(201);
    appointmentId = consulta.body.id;

    bancoId = await criarConta('Banco E2E', 'bank');
    stoneId = await criarConta('Stone Crédito E2E', 'card_credit');
    caixaId = await criarConta('Caixa Físico E2E', 'cash_drawer');

    await request(app.getHttpServer())
      .put('/finance/payment-methods/pix')
      .set(auth())
      .send({ active: true, defaultAccountId: bancoId, maxInstallments: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .put('/finance/payment-methods/credit_card')
      .set(auth())
      .send({ active: true, defaultAccountId: stoneId, maxInstallments: 6 })
      .expect(200);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('cria a cobrança a partir da consulta com o valor previsto', async () => {
    const res = await request(app.getHttpServer())
      .post(`/finance/receivables/from-appointment/${appointmentId}`)
      .set(auth())
      .send({})
      .expect(201);
    receivableId = res.body.id;
    expect(res.body.status).toBe('open');
    expect(res.body.totalAmount).toBe('300.00');
    expect(res.body.items[0].executedBy.id).toBe(doctorId);
  });

  it('cobrar a mesma consulta de novo dá 409', async () => {
    await request(app.getHttpServer())
      .post(`/finance/receivables/from-appointment/${appointmentId}`)
      .set(auth())
      .send({})
      .expect(409);
  });

  it('o selo da agenda mostra a cobrança em aberto', async () => {
    const res = await request(app.getHttpServer())
      .get(`/finance/appointments/status?ids=${appointmentId}`)
      .set(auth())
      .expect(200);
    expect(res.body).toEqual([{ appointmentId, receivableId, status: 'open' }]);
  });

  it('dinheiro sem caixa aberto é recusado', async () => {
    await request(app.getHttpServer())
      .post(`/finance/receivables/${receivableId}/payments`)
      .set(auth())
      .send({ lines: [{ method: 'cash', amount: '10.00' }] })
      .expect(400);
  });

  it('pagamento dividido em PIX e crédito 3x quita a cobrança', async () => {
    const res = await request(app.getHttpServer())
      .post(`/finance/receivables/${receivableId}/payments`)
      .set(auth())
      .send({
        lines: [
          { method: 'pix', amount: '150.00' },
          {
            method: 'credit_card',
            amount: '150.00',
            installments: 3,
            cardBrand: 'Visa',
          },
        ],
      })
      .expect(201);
    expect(res.body.status).toBe('paid');
    expect(res.body.payments).toHaveLength(2);
  });

  it('pagar acima do saldo é recusado', async () => {
    await request(app.getHttpServer())
      .post(`/finance/receivables/${receivableId}/payments`)
      .set(auth())
      .send({ lines: [{ method: 'pix', amount: '0.01' }] })
      .expect(400);
  });

  it('estorno parcial volta a cobrança para parcial', async () => {
    const detalhe = await request(app.getHttpServer())
      .get(`/finance/receivables/${receivableId}`)
      .set(auth())
      .expect(200);
    const pix = (
      detalhe.body.payments as { id: string; method: string }[]
    ).find((p) => p.method === 'pix');
    const res = await request(app.getHttpServer())
      .post(`/finance/payments/${pix?.id}/refunds`)
      .set(auth())
      .send({ amount: '50.00', reason: 'courtesy_discount' })
      .expect(201);
    expect(res.body.status).toBe('partial');
    expect(res.body.paidAmount).toBe('250.00');
    expect(res.body.balance).toBe('50.00');
  });

  it('outra conta não enxerga a cobrança', async () => {
    await request(app.getHttpServer())
      .get(`/finance/receivables/${receivableId}`)
      .set(auth(outroToken))
      .expect(404);
  });

  it('caixa: abre, recebe em dinheiro, fecha com diferença', async () => {
    await request(app.getHttpServer())
      .post('/finance/cash-sessions')
      .set(auth())
      .send({ accountId: caixaId, openingAmount: '100.00' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/finance/cash-sessions')
      .set(auth())
      .send({ accountId: caixaId, openingAmount: '0' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/finance/receivables/${receivableId}/payments`)
      .set(auth())
      .send({ lines: [{ method: 'cash', amount: '50.00' }] })
      .expect(201);
    const fechado = await request(app.getHttpServer())
      .post('/finance/cash-sessions/current/close')
      .set(auth())
      .send({ countedAmount: '148.00' })
      .expect(201);
    expect(fechado.body.expectedAmount).toBe('150.00');
    expect(fechado.body.difference).toBe('-2.00');
    const atual = await request(app.getHttpServer())
      .get('/finance/cash-sessions/current')
      .set(auth())
      .expect(200);
    expect(atual.body.session).toBeNull();
  });
});
