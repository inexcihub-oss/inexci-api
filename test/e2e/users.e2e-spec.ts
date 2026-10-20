import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';
import { TestDataFactory } from '../helpers/test-data-factory';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let currentUser: any;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
    currentUser = auth.user;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/users/profile (GET)', () => {
    it('should return current user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/profile')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body.id).toBe(currentUser.id);
      expect(response.body.email).toBe(currentUser.email);
      expect(response.body).toHaveProperty('name');
      expect(response.body).toHaveProperty('isDoctor');
      expect(Array.isArray(response.body.permissions)).toBe(true);
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('isPlatformAdmin');
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer()).get('/users/profile').expect(401);
    });
  });

  describe('/users/profile (PUT)', () => {
    it('should update current user profile', async () => {
      const response = await request(app.getHttpServer())
        .put('/users/profile')
        .set(getAuthHeader(authToken))
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');

      const depois = await request(app.getHttpServer())
        .get('/users/profile')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(depois.body.name).toBe('Updated Name');
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .put('/users/profile')
        .send({ name: 'Test' })
        .expect(401);
    });
  });

  describe('/users (POST)', () => {
    it('should create a new user with valid data', async () => {
      const userData = TestDataFactory.generateCreateUserData();

      const response = await request(app.getHttpServer())
        .post('/users')
        .set(getAuthHeader(authToken))
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.email).toBe(userData.email);
      expect(response.body.name).toBe(userData.name);
    });

    it('deve recusar a criação de um usuário com role admin', async () => {
      const userData = TestDataFactory.generateCreateUserData();

      await request(app.getHttpServer())
        .post('/users')
        .set(getAuthHeader(authToken))
        .send({ ...userData, role: 'admin' })
        .expect(400);
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
      const userData = TestDataFactory.generateCreateUserData();
      userData.email = 'invalid-email';

      await request(app.getHttpServer())
        .post('/users')
        .set(getAuthHeader(authToken))
        .send(userData)
        .expect(400);
    });

    it('should fail without authentication', async () => {
      const userData = TestDataFactory.generateCreateUserData();
      await request(app.getHttpServer())
        .post('/users')
        .send(userData)
        .expect(401);
    });
  });

  describe('Authorization', () => {
    it('should deny access with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should deny access without token', async () => {
      await request(app.getHttpServer()).get('/users/profile').expect(401);
    });
  });
});
