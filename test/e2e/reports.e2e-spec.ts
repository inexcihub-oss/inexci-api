import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

/**
 * Rotas reais de `ReportsController` (src/modules/reports/reports.controller.ts),
 * todas GET e sob `@RequirePermission(Permission.SOLICITACOES)`:
 * `dashboard`, `dashboard-full`, `temporal-evolution`, `average-completion-time`,
 * `pending-notifications` e `monthly-evolution`.
 *
 * Este spec cobre `dashboard` e `pending-notifications` — as duas que já estavam
 * aqui. Os asserts agora são determinísticos: `ReportsService` só agrega
 * contagens e o repositório devolve `CAST(... AS INTEGER)` /
 * `Number(...) || 0` sobre `COALESCE`, então clínica vazia dá zero, nunca null
 * nem erro. O antigo `expect([200, 500])` passava até se a rota derrubasse o
 * serviço, e o `expect([200, 404, 500])` de `pending-notifications` passaria até
 * se a rota tivesse sido apagada.
 */

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
  /** Admin de uma clínica sem nenhum médico cadastrado. */
  let tokenAdminSemMedicos: string;
  /** Médico de outra clínica, dono de exatamente 1 SC em PENDING. */
  let tokenMedico: string;

  // Todos os testes são GET (não mutam estado), então o fixture é montado uma
  // única vez — `cleanDatabase` no `beforeEach` só recriaria o mesmo cenário.
  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    // Tenant A: admin sem médicos na clínica. Exercita o early-return de
    // `ReportsService.dashboard` (`getAccessibleDoctorIds` vazio).
    const auth = await getAuthenticatedRequest(app);
    tokenAdminSemMedicos = auth.token;

    // Tenant B: médico com 1 SC. Exercita as agregações de verdade
    // (`countsByStatus`, `sumInvoiced`, `totalBy*`), não o atalho de lista vazia.
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

    // Sem hospital/convênio de propósito: cobre o `COALESCE` de
    // `totalByHospital`/`totalByHealthPlan` ('Sem Hospital' / 'Sem Convênio').
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

      // `dashboard` retorna este payload literal quando `doctorIds` é vazio.
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

      // A SC nasce em PENDING(1): entra em `total`, em nenhum dos contadores
      // por status (SCHEDULED/PERFORMED/INVOICED) e sem billing associado.
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
      // Orçamento folgado de propósito: não é um teste de performance, é uma
      // rede contra travamento (o dashboard já causou lentidão real). Só é uma
      // asserção viva porque o `testTimeout` do jest-e2e é 120s — se fosse menor
      // que o orçamento, o teste estouraria antes de chegar ao expect.
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

      // `pendingNotifications` conta apenas SCs em IN_ANALYSIS ou IN_SCHEDULING
      // com `updated_at` anterior a 5 dias. A SC do fixture está em PENDING e
      // acabou de ser criada, então nenhum dos dois filtros casa.
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

  // Removido o describe 'Authorization': repetia literalmente os dois testes de
  // 401 (sem token / token inválido) já feitos em '/reports/dashboard (GET)'.
});
