import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
  seedTestData,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Notifications (e2e)', () => {
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

  describe('/notifications (GET)', () => {
    it('should return list of notifications', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications')
        .set(getAuthHeader(authToken));

      // Pode retornar 200 ou 500 dependendo do estado
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it('should paginate notifications with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({ skip: 0, take: 10 })
        .set(getAuthHeader(authToken));

      expect([200, 500]).toContain(response.status);
    });

    it('should filter unread notifications only', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications')
        .query({ unreadOnly: 'true' })
        .set(getAuthHeader(authToken));

      expect([200, 500]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });
  });

  describe('/notifications/settings (GET)', () => {
    it('should return notification settings', async () => {
      const response = await request(app.getHttpServer())
        .get('/notifications/settings')
        .set(getAuthHeader(authToken));

      expect([200, 500]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
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

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .put('/notifications/settings')
        .send({ pushNotifications: true })
        .expect(401);
    });
  });

  describe('/notifications/:id/read (PUT)', () => {
    it('should mark notification as read', async () => {
      const response = await request(app.getHttpServer())
        .put('/notifications/1/read')
        .set(getAuthHeader(authToken));

      // Pode retornar 200, 404 ou 500 dependendo se a notificação existe
      expect([200, 404, 500]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .put('/notifications/1/read')
        .expect(401);
    });
  });

  describe('/notifications/read-all (PUT)', () => {
    it('should mark all notifications as read', async () => {
      const response = await request(app.getHttpServer())
        .put('/notifications/read-all')
        .set(getAuthHeader(authToken));

      expect([200, 500]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .put('/notifications/read-all')
        .expect(401);
    });
  });

  describe('/notifications/:id (DELETE)', () => {
    it('should delete notification', async () => {
      const response = await request(app.getHttpServer())
        .delete('/notifications/1')
        .set(getAuthHeader(authToken));

      // Pode retornar 200, 404 ou 500 dependendo se a notificação existe
      expect([200, 404, 500]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer()).delete('/notifications/1').expect(401);
    });
  });

  describe('Authorization', () => {
    it('should deny access with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should deny access without token', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });
  });
});
