import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { getAuthHeader } from '../helpers/auth-helper';

/**
 * Rotas reais de `ProceduresController` (`surgery-requests/procedures`):
 * `POST /`, `POST /authorize`, `PATCH /:id` e `DELETE /:id`. Só as duas
 * primeiras são exercitadas aqui — `PATCH`/`DELETE` seguem sem cobertura e2e.
 *
 * Os asserts abaixo são fechados de propósito: a versão anterior deste spec
 * aceitava faixas de status (`[201, 500]`, `[200, 201, 404]`) e criava a SC por
 * `POST /surgery-requests/simple`, rota que não existe. O 404 do setup deixava
 * `testSurgeryRequestId` indefinido e cada teste retornava cedo com um
 * `console.warn` — a suíte passava sem chamar o controller uma única vez.
 */

const MEDICO = {
  name: 'Dra. Teste Procedimentos E2E',
  email: 'dra.procedimentos.e2e@inexci.test',
  phone: '11977770101',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM654321',
  crmState: 'SP',
  specialty: 'Ortopedia',
};

/** UUID bem formado e sem linha correspondente — o id precisa ser UUID porque
 *  as colunas `surgery_requests.id` e `surgery_request_tuss_items.id` são
 *  `uuid`; um id fora do formato faria o Postgres estourar (500) em vez de
 *  exercitar o 404 de negócio. */
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

describe('Surgery Request Procedures (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let testSurgeryRequestId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);

    // `isDoctor: true` cria o `doctor_profile`. Sem ele,
    // `DoctorResolutionService.resolveDoctorId` não acha médico acessível e
    // `POST /surgery-requests` responde 403 antes de criar qualquer coisa.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(MEDICO)
      .expect(201);

    await prepararUsuarioParaLogin(app, MEDICO.email);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: MEDICO.email, password: MEDICO.password })
      .expect(201);
    authToken = login.body.access_token;

    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set(getAuthHeader(authToken))
      .send({ name: 'Paciente Procedimentos E2E', cpf: '12345678900' })
      .expect(201);

    // Rota real de criação: `POST /surgery-requests` (o "simple" do caminho
    // antigo sobrevive apenas no nome do DTO, `CreateSurgeryRequestSimpleDto`).
    const surgeryRequest = await request(app.getHttpServer())
      .post('/surgery-requests')
      .set(getAuthHeader(authToken))
      .send({ patientId: patient.body.id, priority: 2 })
      .expect(201);
    testSurgeryRequestId = surgeryRequest.body.id;
    expect(testSurgeryRequestId).toEqual(expect.any(String));
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  /** Item TUSS válido para a SC do teste — devolve o id gerado. */
  async function criarItemTuss(tussCode = '30101012'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/surgery-requests/procedures')
      .set(getAuthHeader(authToken))
      .send({
        surgeryRequestId: testSurgeryRequestId,
        procedures: [
          {
            tussCode,
            name: 'Colecistectomia Videolaparoscópica',
            quantity: 1,
          },
        ],
      })
      .expect(201);
    return response.body[0].id;
  }

  describe('/surgery-requests/procedures (POST)', () => {
    it('cria os procedimentos TUSS da solicitação', async () => {
      const response = await request(app.getHttpServer())
        .post('/surgery-requests/procedures')
        .set(getAuthHeader(authToken))
        .send({
          surgeryRequestId: testSurgeryRequestId,
          procedures: [
            {
              tussCode: '30101012',
              name: 'Colecistectomia Videolaparoscópica',
              quantity: 2,
            },
          ],
        })
        .expect(201);

      // `ProceduresService.create` devolve um item por procedimento enviado,
      // sempre com `authorizedQuantity: null` (autorização é passo posterior).
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toEqual({
        id: expect.any(String),
        tussCode: '30101012',
        name: 'Colecistectomia Videolaparoscópica',
        quantity: 2,
        authorizedQuantity: null,
      });
    });

    it('recusa o mesmo código TUSS duas vezes na mesma solicitação', async () => {
      await criarItemTuss('30101012');

      // Duplicata é regra de negócio explícita do service (BadRequestException).
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures')
        .set(getAuthHeader(authToken))
        .send({
          surgeryRequestId: testSurgeryRequestId,
          procedures: [{ tussCode: '30101012', name: 'Repetido', quantity: 1 }],
        })
        .expect(400);
    });

    it('recusa requisição sem autenticação', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures')
        .send({
          surgeryRequestId: ID_INEXISTENTE,
          procedures: [{ tussCode: '30101012', name: 'X', quantity: 1 }],
        })
        .expect(401);
    });

    it('recusa payload sem surgeryRequestId', async () => {
      // `surgeryRequestId` é `@IsString @IsNotEmpty` no DTO — barra na
      // ValidationPipe global antes de chegar ao service.
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures')
        .set(getAuthHeader(authToken))
        .send({ procedures: [] })
        .expect(400);
    });

    it('responde 404 para solicitação inexistente', async () => {
      // `SurgeryRequestAccessValidator.validateAndFetch` roda antes de qualquer
      // escrita e lança NotFoundException quando a SC não existe (ou é de outro
      // tenant) — 404 é o único status possível aqui.
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures')
        .set(getAuthHeader(authToken))
        .send({
          surgeryRequestId: ID_INEXISTENTE,
          procedures: [
            { tussCode: '30101012', name: 'Colecistectomia', quantity: 1 },
          ],
        })
        .expect(404);
    });
  });

  describe('/surgery-requests/procedures/authorize (POST)', () => {
    it('grava a quantidade autorizada do item TUSS', async () => {
      const tussItemId = await criarItemTuss();

      // Sem `@HttpCode`, o `@Post('authorize')` responde 201 e o service
      // devolve um objeto vazio — o efeito é observável só na SC.
      const response = await request(app.getHttpServer())
        .post('/surgery-requests/procedures/authorize')
        .set(getAuthHeader(authToken))
        .send({
          surgeryRequestId: testSurgeryRequestId,
          surgeryRequestProcedures: [{ id: tussItemId, authorizedQuantity: 1 }],
          opmeItems: [],
        })
        .expect(201);
      expect(response.body).toEqual({});

      const detalhe = await request(app.getHttpServer())
        .get('/surgery-requests/one')
        .query({ id: testSurgeryRequestId })
        .set(getAuthHeader(authToken))
        .expect(200);
      expect(detalhe.body.tussItems).toEqual([
        expect.objectContaining({ id: tussItemId, authorizedQuantity: 1 }),
      ]);
    });

    it('recusa requisição sem autenticação', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures/authorize')
        .send({
          surgeryRequestId: ID_INEXISTENTE,
          surgeryRequestProcedures: [],
          opmeItems: [],
        })
        .expect(401);
    });

    it('recusa payload sem surgeryRequestId e sem opmeItems', async () => {
      // `surgeryRequestId` e `opmeItems` são obrigatórios no
      // `AuthorizeProceduresDto` (nenhum é `@IsOptional`).
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures/authorize')
        .set(getAuthHeader(authToken))
        .send({ surgeryRequestProcedures: [] })
        .expect(400);
    });

    it('responde 404 quando o item não pertence à solicitação', async () => {
      await criarItemTuss();

      // Proteção de tenant: o service confere item por item o vínculo com a SC
      // já validada e lança NotFoundException no primeiro id estranho — é o que
      // impede zerar quantidades de uma cirurgia de outra clínica.
      await request(app.getHttpServer())
        .post('/surgery-requests/procedures/authorize')
        .set(getAuthHeader(authToken))
        .send({
          surgeryRequestId: testSurgeryRequestId,
          surgeryRequestProcedures: [
            { id: ID_INEXISTENTE, authorizedQuantity: 1 },
          ],
          opmeItems: [],
        })
        .expect(404);
    });
  });
});
