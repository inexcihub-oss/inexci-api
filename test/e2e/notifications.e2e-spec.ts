import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
  createUserWithRole,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

/**
 * Rotas realmente expostas por `src/modules/notifications`:
 *   GET    /notifications
 *   GET    /notifications/settings
 *   PUT    /notifications/settings
 *   PUT    /notifications/:id/read
 *   PUT    /notifications/read-all
 *   DELETE /notifications/:id
 *
 * O submódulo `health/` registra `GET /health/notifications` (`@Public`), fora
 * do prefixo `/notifications` — ele não é coberto aqui porque abre socket TCP
 * real para Redis e SMTP (`NotificationsHealthService.checkTcpConnection`) e o
 * resultado depende do ambiente, não do código.
 *
 * `NotificationsController` não tem `@RequirePermission`, então basta estar
 * autenticado: os status são determinísticos e os testes abaixo afirmam o
 * status exato, nunca um conjunto tolerante.
 */

/** Insere uma notificação direto no banco — não há rota de criação. */
async function criarNotificacao(
  app: INestApplication,
  params: {
    userId: string;
    title?: string;
    read?: boolean;
    createdAt?: Date;
  },
): Promise<string> {
  const dataSource = app.get(DataSource);
  const createdAt = (params.createdAt ?? new Date()).toISOString();
  const rows = await dataSource.query(
    `INSERT INTO notifications (user_id, type, title, message, read, created_at, updated_at)
     VALUES ($1, 'info', $2, 'Mensagem de teste', $3, $4, $4)
     RETURNING id`,
    [
      params.userId,
      params.title ?? 'Notificação',
      params.read ?? false,
      createdAt,
    ],
  );
  return rows[0].id as string;
}

async function estaLida(app: INestApplication, id: string): Promise<boolean> {
  const dataSource = app.get(DataSource);
  const rows = await dataSource.query(
    `SELECT read FROM notifications WHERE id = $1`,
    [id],
  );
  return rows[0]?.read as boolean;
}

async function existeNotificacao(
  app: INestApplication,
  id: string,
): Promise<boolean> {
  const dataSource = app.get(DataSource);
  const rows = await dataSource.query(
    `SELECT 1 FROM notifications WHERE id = $1`,
    [id],
  );
  return rows.length > 0;
}

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let currentUser: { id: string };

  // UUID válido que nunca é gerado pelo banco — usado para o caso "não existe".
  // Precisa ser UUID: a coluna `notifications.id` é UUID e um id não-UUID
  // estoura no Postgres (22P02) e vira 500, não 404.
  const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';

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

  describe('/notifications (GET)', () => {
    it('lista as notificações do usuário, mais recentes primeiro, com unreadCount', async () => {
      await criarNotificacao(app, {
        userId: currentUser.id,
        title: 'Antiga',
        read: true,
        createdAt: new Date(Date.now() - 60_000),
      });
      await criarNotificacao(app, {
        userId: currentUser.id,
        title: 'Recente',
        read: false,
      });

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(2);
      // `findByUserId` ordena por created_at DESC.
      expect(response.body.notifications[0].title).toBe('Recente');
      expect(response.body.notifications[1].title).toBe('Antiga');
      expect(response.body.unreadCount).toBe(1);
    });

    it('não devolve notificação de outro usuário', async () => {
      const outro = await createUserWithRole(app, {
        email: 'outro-usuario@test.com',
        name: 'Outro Usuário',
        role: 'admin',
      });
      await criarNotificacao(app, { userId: outro.id, title: 'Do outro' });

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(0);
      expect(response.body.unreadCount).toBe(0);
    });

    it('respeita skip e take', async () => {
      for (let i = 0; i < 3; i++) {
        await criarNotificacao(app, {
          userId: currentUser.id,
          title: `N${i}`,
          createdAt: new Date(Date.now() - i * 60_000),
        });
      }

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({ skip: 1, take: 1 })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(1);
      // skip=1 sobre a ordem DESC (N0, N1, N2) cai na segunda mais recente.
      expect(response.body.notifications[0].title).toBe('N1');
      // `total` é o total do filtro (3), não o tamanho da página (1).
      expect(response.body.total).toBe(3);
      expect(response.body.unreadCount).toBe(3);
    });

    it('filtra apenas as não lidas com unreadOnly=true', async () => {
      await criarNotificacao(app, {
        userId: currentUser.id,
        title: 'Lida',
        read: true,
      });
      await criarNotificacao(app, {
        userId: currentUser.id,
        title: 'Não lida',
        read: false,
      });

      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({ unreadOnly: 'true' })
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.notifications[0].title).toBe('Não lida');
      // `total` respeita o filtro da listagem: só a não lida entra.
      expect(response.body.total).toBe(1);
      // unreadCount vem de `countUnread`, que ignora o filtro da listagem.
      expect(response.body.unreadCount).toBe(1);
    });

    it('recusa acesso sem autenticação', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });

    it('recusa acesso com token inválido', async () => {
      await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/notifications/settings (GET)', () => {
    it('cria e devolve as configurações padrão no primeiro acesso', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications/settings')
        .set(getAuthHeader(authToken));

      // `getSettings` faz lazy-create quando não há registro — os defaults
      // abaixo são os passados explicitamente pelo service.
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        userId: currentUser.id,
        pushNotifications: true,
        whatsappNotifications: true,
        newSurgeryRequest: true,
        statusUpdate: true,
        pendencies: true,
        expiringDocuments: true,
        weeklyReport: false,
      });
    });

    it('recusa acesso sem autenticação', async () => {
      await request(app.getHttpServer())
        .get('/notifications/settings')
        .expect(401);
    });
  });

  describe('/notifications/settings (PUT)', () => {
    it('aceita payload em camelCase e devolve 200', async () => {
      const response = await request(app.getHttpServer())
        .put('/notifications/settings')
        .set(getAuthHeader(authToken))
        .send({
          pushNotifications: false,
          whatsappNotifications: true,
          statusUpdate: true,
          weeklyReport: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.pushNotifications).toBe(false);
      expect(response.body.whatsappNotifications).toBe(true);
    });

    it('persiste a alteração para o GET seguinte', async () => {
      await request(app.getHttpServer())
        .put('/notifications/settings')
        .set(getAuthHeader(authToken))
        .send({ pushNotifications: false, weeklyReport: true })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/notifications/settings')
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.pushNotifications).toBe(false);
      expect(response.body.weeklyReport).toBe(true);
    });

    it('rejeita payload em snake_case (formato legado removido)', async () => {
      const response = await request(app.getHttpServer())
        .put('/notifications/settings')
        .set(getAuthHeader(authToken))
        .send({
          push_notifications: false,
          whatsapp_notifications: true,
        });

      expect(response.status).toBe(400);
    });

    it('rejeita campo de SMS (canal removido)', async () => {
      const response = await request(app.getHttpServer())
        .put('/notifications/settings')
        .set(getAuthHeader(authToken))
        .send({ smsNotifications: true });

      expect(response.status).toBe(400);
    });

    it('rejeita campo de e-mail (canal removido para usuários do sistema)', async () => {
      const response = await request(app.getHttpServer())
        .put('/notifications/settings')
        .set(getAuthHeader(authToken))
        .send({ emailNotifications: true });

      expect(response.status).toBe(400);
    });

    it('recusa acesso sem autenticação', async () => {
      await request(app.getHttpServer())
        .put('/notifications/settings')
        .send({ pushNotifications: true })
        .expect(401);
    });
  });

  describe('/notifications/:id/read (PUT)', () => {
    it('marca a notificação como lida', async () => {
      const id = await criarNotificacao(app, { userId: currentUser.id });

      const response = await request(app.getHttpServer())
        .put(`/notifications/${id}/read`)
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Notificação marcada como lida');
      expect(await estaLida(app, id)).toBe(true);
    });

    it('devolve 404 quando a notificação não existe', async () => {
      // `UPDATE ... WHERE id = ? AND user_id = ?` com 0 linhas alteradas não
      // pode responder "marcada como lida".
      await request(app.getHttpServer())
        .put(`/notifications/${UUID_INEXISTENTE}/read`)
        .set(getAuthHeader(authToken))
        .expect(404);
    });

    it('devolve 400 quando o id não é uuid', async () => {
      await request(app.getHttpServer())
        .put('/notifications/nao-e-uuid/read')
        .set(getAuthHeader(authToken))
        .expect(400);
    });

    it('não marca como lida a notificação de outro usuário', async () => {
      const outro = await createUserWithRole(app, {
        email: 'outro-read@test.com',
        name: 'Outro Read',
        role: 'admin',
      });
      const id = await criarNotificacao(app, { userId: outro.id });

      // O `user_id` faz parte do WHERE: nada é alterado, e a resposta é a
      // mesma de um id inexistente (não revela que a notificação existe).
      await request(app.getHttpServer())
        .put(`/notifications/${id}/read`)
        .set(getAuthHeader(authToken))
        .expect(404);

      expect(await estaLida(app, id)).toBe(false);
    });

    it('recusa acesso sem autenticação', async () => {
      await request(app.getHttpServer())
        .put(`/notifications/${UUID_INEXISTENTE}/read`)
        .expect(401);
    });
  });

  describe('/notifications/read-all (PUT)', () => {
    it('marca todas as notificações do usuário como lidas', async () => {
      const id1 = await criarNotificacao(app, { userId: currentUser.id });
      const id2 = await criarNotificacao(app, { userId: currentUser.id });

      const response = await request(app.getHttpServer())
        .put('/notifications/read-all')
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        'Todas as notificações marcadas como lidas',
      );
      expect(await estaLida(app, id1)).toBe(true);
      expect(await estaLida(app, id2)).toBe(true);
    });

    it('não afeta as notificações de outro usuário', async () => {
      const outro = await createUserWithRole(app, {
        email: 'outro-read-all@test.com',
        name: 'Outro Read All',
        role: 'admin',
      });
      const alheia = await criarNotificacao(app, { userId: outro.id });

      await request(app.getHttpServer())
        .put('/notifications/read-all')
        .set(getAuthHeader(authToken))
        .expect(200);

      expect(await estaLida(app, alheia)).toBe(false);
    });

    it('recusa acesso sem autenticação', async () => {
      await request(app.getHttpServer())
        .put('/notifications/read-all')
        .expect(401);
    });
  });

  describe('/notifications/:id (DELETE)', () => {
    it('remove a notificação do usuário', async () => {
      const id = await criarNotificacao(app, { userId: currentUser.id });

      const response = await request(app.getHttpServer())
        .delete(`/notifications/${id}`)
        .set(getAuthHeader(authToken));

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Notificação removida');
      expect(await existeNotificacao(app, id)).toBe(false);
    });

    it('devolve 404 quando a notificação não existe', async () => {
      await request(app.getHttpServer())
        .delete(`/notifications/${UUID_INEXISTENTE}`)
        .set(getAuthHeader(authToken))
        .expect(404);
    });

    it('devolve 400 quando o id não é uuid', async () => {
      await request(app.getHttpServer())
        .delete('/notifications/nao-e-uuid')
        .set(getAuthHeader(authToken))
        .expect(400);
    });

    it('não remove a notificação de outro usuário', async () => {
      const outro = await createUserWithRole(app, {
        email: 'outro-delete@test.com',
        name: 'Outro Delete',
        role: 'admin',
      });
      const alheia = await criarNotificacao(app, { userId: outro.id });

      await request(app.getHttpServer())
        .delete(`/notifications/${alheia}`)
        .set(getAuthHeader(authToken))
        .expect(404);

      expect(await existeNotificacao(app, alheia)).toBe(true);
    });

    it('recusa acesso sem autenticação', async () => {
      await request(app.getHttpServer())
        .delete(`/notifications/${UUID_INEXISTENTE}`)
        .expect(401);
    });
  });
});
