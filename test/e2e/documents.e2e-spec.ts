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

/**
 * UUID bem formado que não corresponde a nenhuma solicitação cirúrgica.
 * Precisa ser UUID: `SurgeryRequestOwnerGuard` (rotas JSON) e o repositório
 * (rota multipart) consultam uma coluna `uuid`.
 */
const SC_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

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
    // O payload antigo (`surgeryRequestId` + `documentType`) não existe:
    // `CreateDocumentDto` pede `surgeryRequestId`, `key`, `name` e `folder`.
    // Com `forbidNonWhitelisted: true`, `documentType` sozinho já derrubava
    // toda requisição em 400 — os testes "de upload" nunca chegaram ao service.
    // Nenhum deles verificava o status, então a fachada nunca apareceu.
    it('deve responder 404 quando a solicitação cirúrgica não existe', async () => {
      const response = await request(app.getHttpServer())
        .post('/surgery-requests/documents')
        .set(getAuthHeader(authToken))
        .field('surgeryRequestId', SC_INEXISTENTE)
        .field('key', 'exame')
        .field('name', 'exame.pdf')
        .field('folder', 'documents')
        .attach('document', testFilePath);

      // `SurgeryRequestOwnerGuard` não cobre rotas multipart (guard roda antes
      // do `FileInterceptor`, então o body ainda está vazio). Quem barra aqui é
      // `DocumentsService.create` → `SurgeryRequestAccessValidator`, que escopa
      // por tenant e lança NotFound. O arquivo não chega ao storage.
      expect(response.status).toBe(404);
    });

    it('deve responder 400 quando o arquivo não vem junto', async () => {
      // Campos válidos de propósito: assim o 400 vem de
      // `DocumentsService.create` ("File is required"), e não da validação do
      // DTO. Com o payload antigo o teste passava sem nunca exercitar essa
      // linha.
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
        // 401 exato: o `JwtAuthGuard` global barra antes de qualquer coisa.
        // Aceitar 404 aqui deixava a rota sumir sem o teste reclamar.
        expect(response.status).toBe(401);
      } catch (error: unknown) {
        // EPIPE pode ocorrer quando o servidor fecha a conexão antes do upload
        const err = error as { message?: string; code?: string };
        expect(err.message || err.code).toMatch(/EPIPE|ECONNRESET/);
      }
    });

    // Substitui o antigo "should validate document type": não existe campo
    // `documentType` no DTO. O campo enumerado da rota é `folder`, restrito a
    // `STORAGE_FOLDERS` por `@IsIn` — é ele que precisa recusar valor inválido.
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
    // Antes este teste não verificava status nenhum. Aqui a SC é um uuid bem
    // formado que não existe: o `SurgeryRequestOwnerGuard` (que enxerga o body
    // JSON, ao contrário do multipart) não acha a SC e responde 404 antes de
    // qualquer coisa tocar o documento.
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

    // Ramo diferente do de cima: aqui o id nem tem formato de uuid. O guard
    // roda antes do ValidationPipe, então nenhum DTO barra isso — sem o
    // `isUUID` dele o Postgres abortaria a query e o cliente receberia 500.
    // 404 de propósito: id malformado não pode existir.
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
    // Removido "should accept PDF files": não tinha assert nenhum, usava o
    // payload inválido (`documentType`) e, mesmo corrigido, seria idêntico ao
    // teste de POST acima — aceitar PDF já é exercitado lá.

    it('deve recusar arquivo acima do limite do FileInterceptor', async () => {
      const largFilePath = path.join(
        __dirname,
        '../fixtures/large-document.pdf',
      );

      // 11 MB: acima do teto de `STORAGE_FOLDER_SIZE_LIMITS` (10 MB), que
      // agora é também o `limits.fileSize` do `FileInterceptor`.
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

        // O multer aborta com LIMIT_FILE_SIZE e o @nestjs/platform-express
        // traduz para PayloadTooLargeException — 413, nunca 201/404.
        expect(response.status).toBe(413);
      } finally {
        if (fs.existsSync(largFilePath)) {
          fs.unlinkSync(largFilePath);
        }
      }
    });

    it('não recusa no interceptor um arquivo dentro do limite da config (6 MB)', async () => {
      const filePath = path.join(__dirname, '../fixtures/medium-document.pdf');
      // 6 MB: estourava o antigo `limits.fileSize` de 5 MB, mas está dentro do
      // limite de 10 MB da pasta `documents` em `STORAGE_FOLDER_SIZE_LIMITS`.
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

        // Passa pelo interceptor e morre no 404 da SC inexistente — o que
        // importa aqui é não ser 413.
        expect(response.status).toBe(404);
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });
  });
});
