import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClinicalRecordsController } from '../clinical-records.controller';
import { ClinicalRecordsService } from '../clinical-records.service';
import { ClinicalRecordTemplatesController } from './clinical-record-templates.controller';
import { ClinicalRecordTemplatesService } from './clinical-record-templates.service';
import { ClinicalRecordsModule } from '../clinical-records.module';

/**
 * `clinical-records/templates` é mais um caminho fixo competindo com o
 * `clinical-records/:id` das fichas — mesma armadilha já resolvida em
 * `clinical-records/documents`. Estes testes prendem a ordem de registro.
 */
describe('Modelos de anamnese (rotas)', () => {
  let app: INestApplication;

  const templateId = '44444444-4444-4444-8444-444444444444';

  const templatesService = {
    findMany: jest.fn().mockResolvedValue([{ id: 'tpl-1' }]),
    create: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
    update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
    delete: jest.fn().mockResolvedValue(undefined),
    apply: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
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

  it('registra o controller de modelos antes do de fichas', () => {
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', ClinicalRecordsModule) ?? [];

    expect(controllers.indexOf(ClinicalRecordTemplatesController)).toBeLessThan(
      controllers.indexOf(ClinicalRecordsController),
    );
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ClinicalRecordTemplatesController,
        ClinicalRecordsController,
      ],
      providers: [
        {
          provide: ClinicalRecordTemplatesService,
          useValue: templatesService,
        },
        { provide: ClinicalRecordsService, useValue: recordsService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { userId: 'user-1', ownerId: 'owner-1', role: 'admin' };
      next();
    });
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

  it('GET /clinical-records/templates lista modelos, não uma ficha', async () => {
    await request(app.getHttpServer())
      .get('/clinical-records/templates')
      .expect(200);

    expect(templatesService.findMany).toHaveBeenCalledWith('user-1', undefined);
    expect(recordsService.findOne).not.toHaveBeenCalled();
  });

  it('GET /clinical-records/templates?doctorId filtra por médico', async () => {
    const doctorId = '55555555-5555-4555-8555-555555555555';

    await request(app.getHttpServer())
      .get(`/clinical-records/templates?doctorId=${doctorId}`)
      .expect(200);

    expect(templatesService.findMany).toHaveBeenCalledWith('user-1', doctorId);
  });

  it('POST /clinical-records/templates cria o modelo', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/templates')
      .send({ name: 'Primeira consulta', anamnesis: '<p>Queixa:</p>' })
      .expect(201);

    expect(templatesService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Primeira consulta' }),
      'user-1',
    );
  });

  it('recusa modelo sem nome', async () => {
    await request(app.getHttpServer())
      .post('/clinical-records/templates')
      .send({ anamnesis: '<p>Queixa:</p>' })
      .expect(400);

    expect(templatesService.create).not.toHaveBeenCalled();
  });

  it('PATCH /clinical-records/templates/:id atualiza o modelo', async () => {
    await request(app.getHttpServer())
      .patch(`/clinical-records/templates/${templateId}`)
      .send({ name: 'Renomeado' })
      .expect(200);

    expect(templatesService.update).toHaveBeenCalledWith(
      templateId,
      expect.objectContaining({ name: 'Renomeado' }),
      'user-1',
    );
    expect(recordsService.update).not.toHaveBeenCalled();
  });

  it('POST /clinical-records/templates/:id/apply conta o uso', async () => {
    await request(app.getHttpServer())
      .post(`/clinical-records/templates/${templateId}/apply`)
      .expect(201);

    expect(templatesService.apply).toHaveBeenCalledWith(templateId, 'user-1');
  });

  it('DELETE /clinical-records/templates/:id exclui o modelo, não a ficha', async () => {
    await request(app.getHttpServer())
      .delete(`/clinical-records/templates/${templateId}`)
      .expect(200);

    expect(templatesService.delete).toHaveBeenCalledWith(templateId, 'user-1');
    expect(recordsService.delete).not.toHaveBeenCalled();
  });
});
