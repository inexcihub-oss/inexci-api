import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalRecordsModule } from './clinical-records.module';
import { ClinicalRecordsService } from './clinical-records.service';
import { ClinicalDocumentsController } from './documents/clinical-documents.controller';
import { ClinicalDocumentsService } from './documents/clinical-documents.service';
import { ClinicalDocumentGenerationService } from './documents/clinical-document-generation.service';

/**
 * `clinical-records/documents` é um caminho fixo que colide com o
 * `clinical-records/:id` do controller de fichas. Quando o de fichas era
 * registrado primeiro, listar e excluir documentos caía em `findOne`/`delete`
 * com id `"documents"` e estourava no banco (500, invalid input syntax for
 * type uuid). Estes testes prendem a ordem de registro e a validação do `:id`.
 */
describe('Roteamento de clinical-records', () => {
  let app: INestApplication;

  // Os testes de HTTP abaixo montam sua própria lista de controllers; este
  // amarra a ordem no módulo de produção, que é onde o bug morava.
  it('registra o controller de documentos antes do de fichas', () => {
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', ClinicalRecordsModule) ?? [];

    expect(controllers.indexOf(ClinicalDocumentsController)).toBeGreaterThan(
      -1,
    );
    expect(controllers.indexOf(ClinicalDocumentsController)).toBeLessThan(
      controllers.indexOf(ClinicalRecordsController),
    );
  });

  const documentsService = {
    listByPatient: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
    delete: jest.fn().mockResolvedValue(undefined),
    create: jest.fn(),
  };
  const recordsService = {
    findOne: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    finalize: jest.fn(),
    create: jest.fn(),
    findByPatient: jest.fn(),
    findByAppointment: jest.fn(),
  };

  const patientId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // Mesma ordem do ClinicalRecordsModule: o caminho específico primeiro.
      controllers: [ClinicalDocumentsController, ClinicalRecordsController],
      providers: [
        { provide: ClinicalDocumentsService, useValue: documentsService },
        { provide: ClinicalRecordsService, useValue: recordsService },
        {
          provide: ClinicalDocumentGenerationService,
          useValue: {
            generatePrescription: jest.fn(),
            generateMedicalCertificate: jest.fn(),
            generateExamReferral: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Substitui o JwtAuthGuard global (vive no AppModule): os handlers só
    // precisam de `request.user`.
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { userId: 'user-1', ownerId: 'owner-1', role: 'admin' };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('GET /clinical-records/documents lista documentos, não uma ficha', async () => {
    await request(app.getHttpServer())
      .get(`/clinical-records/documents?patientId=${patientId}`)
      .expect(200);

    expect(documentsService.listByPatient).toHaveBeenCalledWith(
      patientId,
      'user-1',
    );
    expect(recordsService.findOne).not.toHaveBeenCalled();
  });

  it('DELETE /clinical-records/documents exclui documento, não uma ficha', async () => {
    await request(app.getHttpServer())
      .delete('/clinical-records/documents')
      .send({ documentId: '22222222-2222-4222-8222-222222222222' })
      .expect(200);

    expect(documentsService.delete).toHaveBeenCalled();
    expect(recordsService.delete).not.toHaveBeenCalled();
  });

  it('GET /clinical-records/:id rejeita id que não é UUID com 400', async () => {
    await request(app.getHttpServer())
      .get('/clinical-records/nao-e-uuid')
      .expect(400);

    expect(recordsService.findOne).not.toHaveBeenCalled();
  });

  it('GET /clinical-records/:id continua atendendo um UUID', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    recordsService.findOne.mockResolvedValue({ id });

    await request(app.getHttpServer())
      .get(`/clinical-records/${id}`)
      .expect(200);

    expect(recordsService.findOne).toHaveBeenCalledWith(id, 'user-1');
  });
});
