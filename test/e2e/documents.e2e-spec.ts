import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';
import * as path from 'path';
import * as fs from 'fs';

const SC_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let testFilePath: string;

  beforeAll(async () => {
    app = await createTestApp();

    testFilePath = path.join(__dirname, '../fixtures/test-document.pdf');
    if (!fs.existsSync(path.dirname(testFilePath))) {
      fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    }
    if (!fs.existsSync(testFilePath)) {
      fs.writeFileSync(testFilePath, 'test document content');
    }
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/documents (POST)', () => {
    it('deve responder 404 quando a solicitação cirúrgica não existe', async () => {
      const response = await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgeryRequestId', SC_INEXISTENTE)
        .field('key', 'exame')
        .field('name', 'exame.pdf')
        .field('folder', 'documents')
        .attach('document', testFilePath);

      expect(response.status).toBe(404);
    });

    it('deve responder 400 quando o arquivo não vem junto', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgeryRequestId', SC_INEXISTENTE)
        .field('key', 'exame')
        .field('name', 'exame.pdf')
        .field('folder', 'documents')
        .expect(400);
    });

    it('should fail without required fields', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .attach('document', testFilePath)
        .expect(400);
    });

    it('should fail without authentication', async () => {
      try {
        const response = await request(app.getHttpServer())
          .post('/surgery-requests/documents')
          .field('surgeryRequestId', SC_INEXISTENTE)
          .attach('document', testFilePath);
        expect(response.status).toBe(401);
      } catch (error: unknown) {
        const err = error as { message?: string; code?: string };
        expect(err.message || err.code).toMatch(/EPIPE|ECONNRESET/);
      }
    });

    it('deve recusar folder fora de STORAGE_FOLDERS', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgeryRequestId', SC_INEXISTENTE)
        .field('key', 'exame')
        .field('name', 'exame.pdf')
        .field('folder', 'pasta-inexistente')
        .attach('document', testFilePath)
        .expect(400);
    });
  });

  describe('/surgery-requests/documents (DELETE)', () => {
    it('deve responder 404 para uuid de SC válido porém inexistente', async () => {
      const response = await request(app.getHttpServer())
        .delete('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .send({
          id: SC_INEXISTENTE,
          key: 'exame',
          surgeryRequestId: SC_INEXISTENTE,
        });

      expect(response.status).toBe(404);
    });

    it('should fail to delete non-existent document', async () => {
      const deleteData = {
        id: 999999,
        surgeryRequestId: 1,
      };

      const response = await request(app.getHttpServer())
        .delete('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .send(deleteData);

      expect(response.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .delete('/surgery-requests/documents')
        .send({ id: 1 })
        .expect(401);
    });
  });

  describe('Document file validation', () => {
    it('deve recusar arquivo acima do limite do FileInterceptor', async () => {
      const largFilePath = path.join(
        __dirname,
        '../fixtures/large-document.pdf',
      );

      if (!fs.existsSync(largFilePath)) {
        fs.writeFileSync(largFilePath, Buffer.alloc(11 * 1024 * 1024));
      }

      try {
        const response = await request(app.getHttpServer())
          .post('/surgery-requests/documents')
          .set(getAuthHeader(authToken))
          .field('surgeryRequestId', SC_INEXISTENTE)
          .field('key', 'exame')
          .field('name', 'exame.pdf')
          .field('folder', 'documents')
          .attach('document', largFilePath);

        expect(response.status).toBe(413);
      } finally {
        if (fs.existsSync(largFilePath)) {
          fs.unlinkSync(largFilePath);
        }
      }
    });

    it('não recusa no interceptor um arquivo dentro do limite da config (6 MB)', async () => {
      const filePath = path.join(__dirname, '../fixtures/medium-document.pdf');
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, Buffer.alloc(6 * 1024 * 1024));
      }

      try {
        const response = await request(app.getHttpServer())
          .post('/surgery-requests/documents')
          .set(getAuthHeader(authToken))
          .field('surgeryRequestId', SC_INEXISTENTE)
          .field('key', 'exame')
          .field('name', 'exame.pdf')
          .field('folder', 'documents')
          .attach('document', filePath);

        expect(response.status).toBe(404);
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });
  });
});
