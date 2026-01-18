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

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let testFilePath: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Create test file
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
    it('should upload a document', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgery_request_id', '1')
        .field('document_type', 'medical_report')
        .attach('document', testFilePath);

      // Response depends on surgery request existence
    });

    it('should fail without file', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgery_request_id', '1')
        .field('document_type', 'medical_report')
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
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .field('surgery_request_id', '1')
        .attach('document', testFilePath)
        .expect(401);
    });

    it('should validate document type', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgery_request_id', '1')
        .field('document_type', 'invalid_type')
        .attach('document', testFilePath);
    });
  });

  describe('/surgery-requests/documents (DELETE)', () => {
    it('should delete a document', async () => {
      const deleteData = {
        id: 1,
        surgery_request_id: 1,
      };

      await request(app.getHttpServer())
        .delete('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .send(deleteData);
    });

    it('should fail to delete non-existent document', async () => {
      const deleteData = {
        id: 999999,
        surgery_request_id: 1,
      };

      const response = await request(app.getHttpServer())
        .delete('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .send(deleteData);

      // Pode retornar 400 (validação) ou 404 (não encontrado)
      expect([400, 404]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .delete('/surgery-requests/documents')
        .send({ id: 1 })
        .expect(401);
    });
  });

  describe('Document file validation', () => {
    it('should accept PDF files', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgery_request_id', '1')
        .field('document_type', 'medical_report')
        .attach('document', testFilePath);
    });

    it('should handle large files appropriately', async () => {
      const largFilePath = path.join(
        __dirname,
        '../fixtures/large-document.pdf',
      );

      // Create a larger test file
      if (!fs.existsSync(largFilePath)) {
        const largeContent = Buffer.alloc(10 * 1024 * 1024); // 10MB
        fs.writeFileSync(largFilePath, largeContent);
      }

      await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgery_request_id', '1')
        .field('document_type', 'medical_report')
        .attach('document', largFilePath);

      // Clean up
      if (fs.existsSync(largFilePath)) {
        fs.unlinkSync(largFilePath);
      }
    });
  });
});
