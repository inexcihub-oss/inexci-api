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

  describe('/users (GET)', () => {
    it('should return list of users', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('records');
      expect(Array.isArray(response.body.records)).toBe(true);
    });

    // Só checar `total`/`records` não prova filtro nenhum: a resposta tem essas
    // chaves com ou sem `role`. O que precisa valer é que NADA fora do role
    // pedido volte — o usuário autenticado do teste é admin, então sem o filtro
    // ele apareceria aqui.
    it('deve devolver apenas usuários do role pedido', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .query({ role: 'collaborator' })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(Array.isArray(response.body.records)).toBe(true);
      for (const record of response.body.records) {
        expect(record.role).toBe('collaborator');
      }
      expect(
        response.body.records.some((r: any) => r.id === currentUser.id),
      ).toBe(false);
    });

    // `total` é a contagem sem paginação e `records` é a página: o take tem que
    // limitar o segundo sem mexer no primeiro.
    it('deve limitar a página ao valor de take', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .query({ skip: 0, take: 1 })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(typeof response.body.total).toBe('number');
      expect(response.body.records.length).toBeLessThanOrEqual(1);
      expect(response.body.records.length).toBeLessThanOrEqual(
        response.body.total,
      );
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer()).get('/users').expect(401);
    });
  });

  describe('/users/one (GET)', () => {
    it('should return user by id when user exists', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: currentUser.id })
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.id).toBe(currentUser.id);
    });

    // `users.id` é `uuid`: id fora do formato tem que parar no pipe (400), não
    // virar 500 do Postgres — era o que acontecia antes do `ParseUUIDPipe`.
    it('deve responder 400 (nunca 500) para id fora do formato uuid', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: 999999 })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(400);
    });

    // 404 exato: `UsersService.findOne` escopa a busca por `ownerId`, então
    // para o admin autenticado o id inexistente nunca chega a produzir 403 — o
    // 403 só existe no ramo médico/colaborador, que este teste não exercita.
    // Aceitar os dois deixaria passar uma troca de comportamento silenciosa.
    it('deve responder 404 para uuid válido inexistente', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: '00000000-0000-4000-8000-000000000000' })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(404);
    });

    // 401 e não 400: o `JwtAuthGuard` é global e roda antes dos pipes, então o
    // `ParseUUIDPipe` do `id` nem chega a ser avaliado para quem não está
    // autenticado — sem token, o formato do id é irrelevante.
    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/users/one')
        .query({ id: 1 })
        .expect(401);
    });
  });

  describe('/users/profile (GET)', () => {
    // Antes o teste aceitava 200, 401 ou 500 — com token válido, 401 significa
    // autenticação quebrada e 500 é defeito; aceitar os três fazia o teste
    // passar justamente nos cenários que ele deveria denunciar.
    // `getProfile` busca o usuário autenticado e devolve o perfil: 200 sempre.
    it('should return current user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/profile')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(response.body.id).toBe(currentUser.id);
      expect(response.body.email).toBe(currentUser.email);
      expect(response.body).toHaveProperty('name');
      // `getProfile` deriva `isDoctor` e a permissão EFETIVA (não a coluna
      // crua) e remove `password`/`isPlatformAdmin` do retorno.
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
    // Mesmo motivo do GET acima: com token válido a rota é determinística.
    // `updateProfile` grava e devolve o usuário relido do banco, então dá para
    // conferir a persistência pelo próprio corpo da resposta e por um GET.
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

    // `POST /users` é liberado por Permission.ADMINISTRACAO, que o admin
    // delegado também tem. Aceitar `role: 'admin'` aqui deixaria ele criar um
    // segundo dono para a conta — o novo usuário herdaria o `ownerId` de quem
    // criou em vez de `self.id`, quebrando a invariante que sustenta todo o
    // isolamento de tenant. O DTO recusa com 400 (`@IsIn`).
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
        .get('/users')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should deny access without token', async () => {
      await request(app.getHttpServer()).get('/users').expect(401);
    });
  });
});
