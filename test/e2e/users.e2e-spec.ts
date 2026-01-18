import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
  linkUserToClinic,
  createUserWithPv,
} from '../helpers/test-setup';
import {
  getAuthenticatedRequest,
  getAuthHeader,
  generateTestToken,
} from '../helpers/auth-helper';
import { TestDataFactory } from '../helpers/test-data-factory';

// Constantes de UserPvs (espelhando src/common)
const UserPvs = {
  doctor: 1,
  collaborator: 2,
  hospital: 3,
  patient: 4,
  supplier: 5,
  health_plan: 6,
};

// Constantes de UserStatuses (espelhando src/common)
const UserStatuses = {
  incomplete: 1,
  active: 2,
  inactive: 3,
};

describe('Users (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let currentUser: any;
  let testClinicId: number;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const seedData = await seedTestData(app);
    testClinicId = seedData.clinicId;
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
    currentUser = auth.user;
    // Vincular usuário de teste à clínica
    await linkUserToClinic(app, currentUser.id, testClinicId);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/users (GET)', () => {
    it('should return list of users with required pv parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .query({ pv: UserPvs.collaborator })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('records');
      expect(Array.isArray(response.body.records)).toBe(true);
    });

    it('should paginate users with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .query({ pv: UserPvs.collaborator, skip: 0, take: 10 })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('records');
    });

    it('should fail without pv parameter', async () => {
      await request(app.getHttpServer())
        .get('/users')
        .set(getAuthHeader(authToken))
        .expect(400);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/users')
        .query({ pv: UserPvs.collaborator })
        .expect(401);
    });
  });

  describe('/users/one (GET)', () => {
    it('should return user by id when user exists in same clinic', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: currentUser.id })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toHaveProperty('id');
      // currentUser.id pode ser string ou número dependendo da API
      expect(response.body.id).toBe(Number(currentUser.id));
    });

    it('should return 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: 999999 })
        .set(getAuthHeader(authToken))
        .expect(404);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: 1 })
        .expect(401);
    });
  });

  describe('/users (POST)', () => {
    it('should create a new user with valid data', async () => {
      const userData = TestDataFactory.generateCreateUserData(testClinicId);

      const response = await request(app.getHttpServer())
        .post('/users')
        .set(getAuthHeader(authToken))
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.email).toBe(userData.email);
      expect(response.body.name).toBe(userData.name);
    });

    it('should fail with missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(getAuthHeader(authToken))
        .send({
          name: 'Test User',
        })
        .expect(400);
    });

    it('should fail with invalid email format', async () => {
      const userData = TestDataFactory.generateCreateUserData(testClinicId);
      userData.email = 'invalid-email';

      await request(app.getHttpServer())
        .post('/users')
        .set(getAuthHeader(authToken))
        .send(userData)
        .expect(400);
    });

    it('should fail without authentication', async () => {
      const userData = TestDataFactory.generateCreateUserData(testClinicId);
      await request(app.getHttpServer())
        .post('/users')
        .send(userData)
        .expect(401);
    });
  });

  describe('/users (PUT)', () => {
    it('should update user name', async () => {
      const response = await request(app.getHttpServer())
        .put('/users')
        .set(getAuthHeader(authToken))
        .send({
          id: currentUser.id,
          name: 'Updated Name',
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
    });

    it('should fail to update non-existent user', async () => {
      await request(app.getHttpServer())
        .put('/users')
        .set(getAuthHeader(authToken))
        .send({
          id: 999999,
          name: 'Updated Name',
        })
        .expect(404);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .put('/users')
        .send({ id: 1, name: 'Test' })
        .expect(401);
    });
  });

  describe('/users/complete-register/validate-link (GET)', () => {
    it('should return 401 for doctor user (doctors cannot access this route)', async () => {
      // Doctors não têm permissão para acessar rotas de complete-register
      // O middleware de access level deve retornar 401
      await request(app.getHttpServer())
        .get('/users/complete-register/validate-link')
        .set(getAuthHeader(authToken))
        .expect(401);
    });

    it('should return user data for incomplete patient user', async () => {
      // Criar um usuário paciente com status incomplete
      const incompleteUser = await createUserWithPv(app, {
        email: 'patient@test.com',
        name: 'Test Patient',
        pv: UserPvs.patient,
        status: UserStatuses.incomplete,
        clinicId: testClinicId,
      });

      const patientToken = generateTestToken(incompleteUser.id);

      const response = await request(app.getHttpServer())
        .get('/users/complete-register/validate-link')
        .set(getAuthHeader(patientToken))
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.id).toBe(incompleteUser.id);
    });

    it('should return 400 for patient with complete registration', async () => {
      // Criar um usuário paciente com status active (já completou registro)
      const activePatient = await createUserWithPv(app, {
        email: 'active-patient@test.com',
        name: 'Active Patient',
        pv: UserPvs.patient,
        status: UserStatuses.active,
        clinicId: testClinicId,
      });

      const patientToken = generateTestToken(activePatient.id);

      await request(app.getHttpServer())
        .get('/users/complete-register/validate-link')
        .set(getAuthHeader(patientToken))
        .expect(400);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/users/complete-register/validate-link')
        .expect(401);
    });
  });

  describe('/users/complete-register (POST)', () => {
    it('should return 401 for doctor user (doctors cannot access this route)', async () => {
      // Doctors não têm permissão para acessar rotas de complete-register
      await request(app.getHttpServer())
        .post('/users/complete-register')
        .set(getAuthHeader(authToken))
        .send({
          password: 'NewPassword@123',
          phone: '11999999999',
          document: '12345678901',
        })
        .expect(401);
    });

    it('should fail for already completed patient user', async () => {
      // Criar um usuário paciente com status active (já completou registro)
      const activePatient = await createUserWithPv(app, {
        email: 'completed-patient@test.com',
        name: 'Completed Patient',
        pv: UserPvs.patient,
        status: UserStatuses.active,
        clinicId: testClinicId,
      });

      const patientToken = generateTestToken(activePatient.id);

      await request(app.getHttpServer())
        .post('/users/complete-register')
        .set(getAuthHeader(patientToken))
        .send({
          password: 'NewPassword@123',
          phone: '11999999999',
          document: '12345678901',
        })
        .expect(400);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .post('/users/complete-register')
        .send({ password: 'NewPassword@123' })
        .expect(401);
    });
  });
});
