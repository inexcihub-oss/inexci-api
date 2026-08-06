import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClinicalRecordsController } from '../clinical-records.controller';
import { ClinicalRecordsService } from '../clinical-records.service';
import { ClinicalDocumentsController } from './clinical-documents.controller';
import { ClinicalDocumentsService } from './clinical-documents.service';
import { ClinicalDocumentGenerationService } from './clinical-document-generation.service';

/**
 * Os documentos emitidos no atendimento entram por caminhos fixos abaixo de
 * `clinical-records/documents`, justamente para não disputar rota com o
 * `clinical-records/:id` do controller de fichas.
 */
describe('Emissão de documentos do atendimento (rotas)', () => {
  let app: INestApplication;

  const recordId = '33333333-3333-4333-8333-333333333333';
  const patientId = '44444444-4444-4444-8444-444444444444';
  const doctorId = '55555555-5555-4555-8555-555555555555';

  const generationService = {
    generatePrescription: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    generateMedicalCertificate: jest.fn().mockResolvedValue({ id: 'doc-2' }),
    generateExamReferral: jest.fn().mockResolvedValue({ id: 'doc-3' }),
    previewPrescription: jest.fn().mockResolvedValue('<html>previa</html>'),
    previewMedicalCertificate: jest
      .fn()
      .mockResolvedValue('<html>previa</html>'),
    previewExamReferral: jest.fn().mockResolvedValue('<html>previa</html>'),
  };
  const documentsService = {
    listByPatient: jest.fn(),
    delete: jest.fn(),
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ClinicalDocumentsController, ClinicalRecordsController],
      providers: [
        { provide: ClinicalDocumentsService, useValue: documentsService },
        { provide: ClinicalRecordsService, useValue: recordsService },
        {
          provide: ClinicalDocumentGenerationService,
          useValue: generationService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { userId: 'user-1', ownerId: 'owner-1', role: 'admin' };
      next();
    });
    // Mesma configuração do main.ts — o payload precisa ser validado igual.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('POST /clinical-records/documents/prescription emite a receita', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/prescription')
      .send({
        clinicalRecordId: recordId,
        items: [{ name: 'Dipirona 500mg', instructions: '1 cp de 6/6h' }],
      })
      .expect(201);

    expect(generationService.generatePrescription).toHaveBeenCalledWith(
      recordId,
      expect.objectContaining({
        items: [{ name: 'Dipirona 500mg', instructions: '1 cp de 6/6h' }],
      }),
      'user-1',
    );
    expect(recordsService.findOne).not.toHaveBeenCalled();
  });

  it('recusa receita sem nenhum medicamento', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/prescription')
      .send({ clinicalRecordId: recordId, items: [] })
      .expect(400);

    expect(generationService.generatePrescription).not.toHaveBeenCalled();
  });

  it('recusa receita sem a ficha de origem', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/prescription')
      .send({ items: [{ name: 'Dipirona 500mg' }] })
      .expect(400);

    expect(generationService.generatePrescription).not.toHaveBeenCalled();
  });

  it('POST /clinical-records/documents/medical-certificate emite o atestado', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/medical-certificate')
      .send({ clinicalRecordId: recordId, restDays: 3, includeCid: true })
      .expect(201);

    expect(generationService.generateMedicalCertificate).toHaveBeenCalledWith(
      recordId,
      expect.objectContaining({ restDays: 3, includeCid: true }),
      'user-1',
    );
  });

  it('recusa atestado com afastamento fora do intervalo aceito', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/medical-certificate')
      .send({ clinicalRecordId: recordId, restDays: 0 })
      .expect(400);

    expect(generationService.generateMedicalCertificate).not.toHaveBeenCalled();
  });

  it('POST /clinical-records/documents/exam-referral emite o encaminhamento', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/exam-referral')
      .send({
        clinicalRecordId: recordId,
        exams: [{ name: 'Hemograma completo', tussCode: '4.03.01.01-9' }],
        clinicalIndication: 'Anemia a esclarecer',
      })
      .expect(201);

    expect(generationService.generateExamReferral).toHaveBeenCalledWith(
      recordId,
      expect.objectContaining({
        exams: [{ name: 'Hemograma completo', tussCode: '4.03.01.01-9' }],
        clinicalIndication: 'Anemia a esclarecer',
      }),
      'user-1',
    );
  });

  describe('pré-visualização', () => {
    it('devolve o HTML da prévia, sem emitir', async () => {
      const response = await request(app.getHttpServer())
        .post('/clinical-records/documents/prescription/preview')
        .send({
          clinicalRecordId: recordId,
          items: [{ name: 'Dipirona 500mg' }],
        })
        .expect(200);

      // HTML (não PDF): a prévia é só para conferir na tela, e gerar PDF aqui
      // custaria segundos de Puppeteer por clique.
      expect(response.body).toEqual({ html: '<html>previa</html>' });
      expect(generationService.previewPrescription).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicalRecordId: recordId,
          items: [{ name: 'Dipirona 500mg' }],
        }),
        'user-1',
      );
      expect(generationService.generatePrescription).not.toHaveBeenCalled();
    });

    /**
     * D-11: "Visualizar" não pode criar ficha. Sem `clinicalRecordId` a prévia
     * ainda tem que passar — é o payload que o frontend manda em um atendimento
     * ainda não salvo.
     */
    it('aceita a prévia sem ficha, com paciente e ficha em memória', async () => {
      await request(app.getHttpServer())
        .post('/clinical-records/documents/prescription/preview')
        .send({ patientId, doctorId, items: [{ name: 'Dipirona 500mg' }] })
        .expect(200);

      expect(generationService.previewPrescription).toHaveBeenCalledWith(
        expect.objectContaining({ patientId, doctorId }),
        'user-1',
      );
    });

    it('aceita os CIDs da ficha em memória no atestado e no encaminhamento', async () => {
      const cidCodes = [{ code: 'M54.5', description: 'Dor lombar baixa' }];

      await request(app.getHttpServer())
        .post('/clinical-records/documents/medical-certificate/preview')
        .send({ patientId, restDays: 2, includeCid: true, cidCodes })
        .expect(200);
      expect(generationService.previewMedicalCertificate).toHaveBeenCalledWith(
        expect.objectContaining({ patientId, cidCodes }),
        'user-1',
      );

      await request(app.getHttpServer())
        .post('/clinical-records/documents/exam-referral/preview')
        .send({ patientId, exams: [{ name: 'Hemograma' }], cidCodes })
        .expect(200);
      expect(generationService.previewExamReferral).toHaveBeenCalledWith(
        expect.objectContaining({ patientId, cidCodes }),
        'user-1',
      );
    });

    /** A emissão continua exigindo a ficha — só a prévia é que dispensa. */
    it('não afrouxa a emissão: receita sem ficha continua recusada', async () => {
      await request(app.getHttpServer())
        .post('/clinical-records/documents/prescription')
        .send({ patientId, items: [{ name: 'Dipirona 500mg' }] })
        .expect(400);

      expect(generationService.generatePrescription).not.toHaveBeenCalled();
    });

    it('pré-visualiza atestado e encaminhamento', async () => {
      await request(app.getHttpServer())
        .post('/clinical-records/documents/medical-certificate/preview')
        .send({ clinicalRecordId: recordId, restDays: 2 })
        .expect(200);
      expect(generationService.previewMedicalCertificate).toHaveBeenCalled();

      await request(app.getHttpServer())
        .post('/clinical-records/documents/exam-referral/preview')
        .send({ clinicalRecordId: recordId, exams: [{ name: 'Hemograma' }] })
        .expect(200);
      expect(generationService.previewExamReferral).toHaveBeenCalled();
    });

    it('valida o payload igual à emissão', async () => {
      await request(app.getHttpServer())
        .post('/clinical-records/documents/prescription/preview')
        .send({ clinicalRecordId: recordId, items: [] })
        .expect(400);

      expect(generationService.previewPrescription).not.toHaveBeenCalled();
    });

    it('aceita o CID escolhido para o atestado', async () => {
      await request(app.getHttpServer())
        .post('/clinical-records/documents/medical-certificate')
        .send({
          clinicalRecordId: recordId,
          restDays: 2,
          cid: { code: 'M54.5', description: 'Dor lombar baixa' },
        })
        .expect(201);

      expect(generationService.generateMedicalCertificate).toHaveBeenCalledWith(
        recordId,
        expect.objectContaining({
          cid: { code: 'M54.5', description: 'Dor lombar baixa' },
        }),
        'user-1',
      );
    });
  });

  it('recusa encaminhamento sem exames', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/documents/exam-referral')
      .send({ clinicalRecordId: recordId, exams: [] })
      .expect(400);

    expect(generationService.generateExamReferral).not.toHaveBeenCalled();
  });
});
