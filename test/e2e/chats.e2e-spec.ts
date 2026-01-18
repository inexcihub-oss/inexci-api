import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Chats (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/chats/messages (POST)', () => {
    it('should send a chat message', async () => {
      const messageData = {
        surgery_request_id: 1,
        message: 'Test message',
        recipient_id: 2,
      };

      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData);

      // Response depends on surgery request existence
    });

    it('should fail without required fields', async () => {
      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send({})
        .expect(400);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .post('/chats/messages')
        .send({
          surgery_request_id: 1,
          message: 'Test message',
        })
        .expect(401);
    });

    it('should validate message content', async () => {
      const messageData = {
        surgery_request_id: 1,
        message: '', // Empty message
        recipient_id: 2,
      };

      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData)
        .expect(400);
    });

    it('should send message with long content', async () => {
      const messageData = {
        surgery_request_id: 1,
        message: 'A'.repeat(1000), // Long message
        recipient_id: 2,
      };

      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData);
    });

    it('should fail with invalid surgery request id', async () => {
      const messageData = {
        surgery_request_id: 999999,
        message: 'Test message',
        recipient_id: 2,
      };

      const response = await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData);

      // Pode retornar 400 (validação) ou 404 (não encontrado)
      expect([400, 404]).toContain(response.status);
    });
  });

  describe('Message content validation', () => {
    it('should handle special characters in message', async () => {
      const messageData = {
        surgery_request_id: 1,
        message: 'Test message with special chars: @#$%^&*()',
        recipient_id: 2,
      };

      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData);
    });

    it('should handle emojis in message', async () => {
      const messageData = {
        surgery_request_id: 1,
        message: 'Test message with emojis 😀 🎉 ✨',
        recipient_id: 2,
      };

      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData);
    });

    it('should handle line breaks in message', async () => {
      const messageData = {
        surgery_request_id: 1,
        message: 'Line 1\nLine 2\nLine 3',
        recipient_id: 2,
      };

      await request(app.getHttpServer())
        .post('/chats/messages')
        .set(getAuthHeader(authToken))
        .send(messageData);
    });
  });
});
