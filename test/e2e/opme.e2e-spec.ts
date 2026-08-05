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
 * Rotas reais de `OpmeController` (`surgery-requests/opme`): `POST /`,
 * `PUT /` e `DELETE /:id`. Só o `POST` é exercitado aqui — `PUT`/`DELETE`
 * seguem sem cobertura e2e.
 *
 * A versão anterior deste spec criava a SC por `POST /surgery-requests/simple`,
 * rota que não existe. O 404 do setup deixava `testSurgeryRequestId` indefinido
 * e o teste de criação retornava cedo com um `console.warn`, então o único
 * caminho feliz do módulo nunca era executado.
 */

const MEDICO = {
  name: 'Dr. Teste OPME E2E',
  email: 'dr.opme.e2e@inexci.test',
  phone: '11977770202',
  password: 'Senha@12345',
  isDoctor: true,
  crm: 'CRM112233',
  crmState: 'SP',
  specialty: 'Ortopedia',
};

/** UUID bem formado e sem linha correspondente — `surgery_requests.id` é `uuid`,
 *  então um id fora do formato faria o Postgres estourar (500) em vez de
 *  exercitar o 404 de negócio. */
const ID_SC_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

/** `OpmeService` exige no mínimo 3 fabricantes e 3 fornecedores (MIN_OPME_OPTIONS). */
const validOpmePayload = (surgeryRequestId: string) => ({
  surgeryRequestId,
  name: 'Prótese de quadril titanium',
  manufacturerNames: ['OrthoTech', 'Fab B', 'Fab C'],
  supplierNames: ['Medical Supplies Inc', 'Fornecedor B', 'Fornecedor C'],
  quantity: 1,
});

describe('OPME - Órteses, Próteses e Materiais Especiais (e2e)', () => {
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
      .send({ name: 'Paciente OPME E2E', cpf: '12345678900' })
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

  describe('/surgery-requests/opme (POST)', () => {
    it('cria o item OPME e cadastra fabricantes e fornecedores novos', async () => {
      const response = await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(validOpmePayload(testSurgeryRequestId))
        .expect(201);

      expect(response.body.id).toEqual(expect.any(String));
      expect(response.body.surgeryRequestId).toBe(testSurgeryRequestId);
      expect(response.body.quantity).toBe(1);
      expect(response.body.authorizedQuantity).toBeNull();
      // `brand` saiu do modelo quando OPME passou a ter N fabricantes — o
      // assert é a trava contra o campo voltar pelo `CreateOpmeResponseDto`.
      expect(response.body).not.toHaveProperty('brand');

      // Banco limpo a cada teste: os 3 nomes de cada lista viram cadastros
      // novos no tenant, e é isso que `created*Names` reporta ao frontend.
      expect(response.body.manufacturers).toHaveLength(3);
      expect(response.body.suppliers).toHaveLength(3);
      expect(response.body.createdManufacturerNames).toEqual(
        expect.arrayContaining(['OrthoTech', 'Fab B', 'Fab C']),
      );
      expect(response.body.createdSupplierNames).toEqual(
        expect.arrayContaining([
          'Medical Supplies Inc',
          'Fornecedor B',
          'Fornecedor C',
        ]),
      );
      expect(response.body.manufacturers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
          }),
        ]),
      );
    });

    it('recusa requisição sem autenticação', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .send(validOpmePayload(ID_SC_INEXISTENTE))
        .expect(401);
    });

    it('recusa payload sem quantity e sem surgeryRequestId', async () => {
      // Ambos são obrigatórios no `CreateOpmeDto` — barra na ValidationPipe
      // global antes de chegar ao service.
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send({ name: 'Prótese de quadril' })
        .expect(400);
    });

    it('recusa menos de 3 fabricantes', async () => {
      // `validateMinManufacturers` roda antes da busca da SC: com menos de 3
      // opções o service responde 400 mesmo com uma SC válida.
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send({
          ...validOpmePayload(testSurgeryRequestId),
          manufacturerNames: ['OrthoTech', 'Fab B'],
        })
        .expect(400);
    });

    it('responde 404 para solicitação inexistente', async () => {
      // O payload precisa passar pelos mínimos de fabricante/fornecedor para
      // chegar ao `SurgeryRequestAccessValidator.validateAndFetch`, que é quem
      // lança NotFoundException quando a SC não existe (ou é de outro tenant).
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(validOpmePayload(ID_SC_INEXISTENTE))
        .expect(404);
    });
  });
});
