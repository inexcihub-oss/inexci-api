import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
} from '../helpers/test-setup';
import { getAuthHeader } from '../helpers/auth-helper';

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

const ID_SC_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

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
      expect(response.body).not.toHaveProperty('brand');

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
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send({ name: 'Prótese de quadril' })
        .expect(400);
    });

    it('recusa menos de 3 fabricantes', async () => {
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
      await request(app.getHttpServer())
        .post('/surgery-requests/opme')
        .set(getAuthHeader(authToken))
        .send(validOpmePayload(ID_SC_INEXISTENTE))
        .expect(404);
    });
  });
});
