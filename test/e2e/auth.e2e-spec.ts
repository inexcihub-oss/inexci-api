import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  prepararUsuarioParaLogin,
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

      await prepararUsuarioParaLogin(app, userData.email);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.name).toBe(userData.name);
    });

    it('should fail to register with duplicate email', async () => {
      const userData = TestDataFactory.generateRegisterData();

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

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

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

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

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

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

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(201);

      const token = loginResponse.body.access_token;

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
    const MENSAGEM_GENERICA =
      'Se o e-mail existir, enviaremos um código de recuperação.';

    it('should send recovery email for existing user', async () => {
      const userData = TestDataFactory.generateRegisterData();

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      const response = await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      expect(response.body.message).toBe(MENSAGEM_GENERICA);
    });

    it('não deve revelar se o e-mail existe', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: 'nonexistent@test.com' })
        .expect(201);

      expect(response.body.message).toBe(MENSAGEM_GENERICA);
    });
  });

  describe('/auth/validateRecoveryPasswordCode (POST)', () => {
    it('should validate correct recovery code', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const DataSource = (await import('typeorm')).DataSource;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM users WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

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

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: 'INVALID-CODE-123',
        })
        .expect(400);
    });

    it('should reject already used recovery code', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const DataSource = (await import('typeorm')).DataSource;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM users WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(400);
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
      const DataSource = (await import('typeorm')).DataSource;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM users WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

      const validateResponse = await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(201);
      const { resetToken } = validateResponse.body;

      const response = await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          resetToken,
          password: newPassword,
        })
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('sucesso');

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: newPassword,
        })
        .expect(201);

      expect(loginResponse.body).toHaveProperty('access_token');
    });

    it('não distingue e-mail inexistente de reset token inválido', async () => {
      const userData = TestDataFactory.generateRegisterData();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      const semConta = await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: 'nonexistent@test.com',
          resetToken: 'token-que-nao-existe',
          password: 'NewPassword123!',
        })
        .expect(400);

      const comConta = await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          resetToken: 'token-que-nao-existe',
          password: 'NewPassword123!',
        })
        .expect(400);

      expect(semConta.body.message).toBe(comConta.body.message);
    });

    it('validateRecoveryPasswordCode também não distingue e-mail inexistente', async () => {
      const userData = TestDataFactory.generateRegisterData();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      const semConta = await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({ email: 'nonexistent@test.com', code: 'INVALID-CODE-123' })
        .expect(400);

      const comConta = await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({ email: userData.email, code: 'INVALID-CODE-123' })
        .expect(400);

      expect(semConta.body.message).toBe(comConta.body.message);
    });

    it('should fail with weak password', async () => {
      const userData = TestDataFactory.generateRegisterData();
      const DataSource = (await import('typeorm')).DataSource;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM users WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

      const validateResponse = await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(201);
      const { resetToken } = validateResponse.body;

      await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          resetToken,
          password: '123',
        })
        .expect(400);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(201);
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
      const DataSource = (await import('typeorm')).DataSource;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(userData)
        .expect(201);

      await prepararUsuarioParaLogin(app, userData.email);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: oldPassword,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/sendRecoveryPasswordEmail')
        .send({ email: userData.email })
        .expect(201);

      const dataSource = app.get(DataSource);
      const user = await dataSource.query(
        'SELECT * FROM users WHERE email = $1',
        [userData.email],
      );
      const recoveryCode = await dataSource.query(
        'SELECT * FROM recovery_codes WHERE user_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
        [user[0].id],
      );

      const validateResponse = await request(app.getHttpServer())
        .post('/auth/validateRecoveryPasswordCode')
        .send({
          email: userData.email,
          code: recoveryCode[0].code,
        })
        .expect(201);
      const { resetToken } = validateResponse.body;

      await request(app.getHttpServer())
        .post('/auth/changePassword')
        .send({
          email: userData.email,
          resetToken,
          password: newPassword,
        })
        .expect(201);

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
