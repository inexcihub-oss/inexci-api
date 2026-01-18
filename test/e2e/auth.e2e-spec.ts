import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { TestDataFactory } from '../helpers/test-data-factory';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/auth/health (GET)', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('/auth/register (POST)', () => {
    it('should register a new user successfully', async () => {
      const userData = TestDataFactory.generateRegisterData();

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.name).toBe(userData.name);
    });

    it('should fail to register with duplicate email', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // First registration
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(400);
    });

    it('should fail to register with invalid email', async () => {
      const userData = {
        ...TestDataFactory.generateRegisterData(),
        email: 'invalid-email',
      };

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(400);
    });

    it('should fail to register without required fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({})
        .expect(400);
    });
  });

  describe('/auth/login (POST)', () => {
    it('should login successfully with valid credentials', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // Register user first
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Login
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(201);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(userData.email);
    });

    it('should fail to login with invalid credentials', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Try to login with wrong password
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: 'WrongPassword123!',
        })
        .expect(400);
    });

    it('should fail to login with non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'Password123!',
        })
        .expect(400);
    });
  });

  describe('/auth/me (GET)', () => {
    it('should return current user data with valid token', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Login
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(201);

      const token = loginResponse.body.access_token;

      // Get current user
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.email).toBe(userData.email);
      expect(response.body.name).toBe(userData.name);
    });

    it('should fail without authentication token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('should fail with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/auth/sendRecoveryPasswordEmail (POST)', () => {
    it('should send recovery email for existing user', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Request password recovery
      const response = await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      expect(response.body).toHaveProperty('message');
    });

    it('should handle non-existent email gracefully', async () => {
      // Should not reveal if email exists or not for security
      const response = await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: 'nonexistent@test.com' });

      // Accept both 201 (not revealing) or 404 (revealing) depending on implementation
      expect([200, 201, 404]).toContain(response.status);
    });
  });

  describe('/auth/validateRecoveryPasswordCode (POST)', () => {
    it('should validate correct recovery code', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const DataSource = (await import('typeorm')).DataSource;

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Request password recovery
      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      // Get the recovery code from database (in real scenario, this would come from email)
      // For testing purposes, we need to retrieve it directly
      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM "user" WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_code WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

      // Validate the recovery code
      const response = await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('sucesso');
    });

    it('should reject invalid recovery code', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Request password recovery
      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      // Try to validate with invalid code
      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: 'INVALID-CODE-123',
        })
        .expect(404);
    });

    it('should reject already used recovery code', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const DataSource = (await import('typeorm')).DataSource;

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Request password recovery
      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      // Get the recovery code
      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM "user" WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_code WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

      // Validate the recovery code (first time)
      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(201);

      // Try to validate again (should fail)
      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(404);
    });

    it('should fail without required fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({})
        .expect(400);
    });
  });

  describe('/auth/changePassword (POST)', () => {
    it('should change password successfully', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const newPassword = 'NewPassword123!';

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Change password
      const response = await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          password: newPassword,
        })
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('sucesso');

      // Verify new password works
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: newPassword,
        })
        .expect(201);

      expect(loginResponse.body).toHaveProperty('access_token');
    });

    it('should fail with non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: 'nonexistent@test.com',
          password: 'NewPassword123!',
        })
        .expect(404);
    });

    it('should fail with weak password', async () => {
      const userData = TestDataFactory.generateRegisterData();

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Try to change to weak password
      await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          password: '123', // Too short
        })
        .expect(400);
    });

    it('should fail without required fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({})
        .expect(400);
    });

    it('should verify old password no longer works after change', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const oldPassword = userData.password;
      const newPassword = 'NewPassword123!';

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Verify old password works
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: oldPassword,
        })
        .expect(201);

      // Change password
      await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          password: newPassword,
        })
        .expect(201);

      // Verify old password no longer works
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: oldPassword,
        })
        .expect(400);
    });
  });
});
