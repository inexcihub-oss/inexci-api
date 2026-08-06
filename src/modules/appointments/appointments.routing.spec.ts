import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

/**
 * `appointments.id` e `patients.id` são `uuid`. Sem `ParseUUIDPipe`, um id
 * malformado chegava cru ao Postgres e o `AllExceptionsFilter` devolvia
 * "Erro na operação do banco de dados" — 400 genérico, depois de uma ida
 * inútil ao banco. Estes testes prendem a validação em todas as rotas com
 * `:id`/`:patientId`, no mesmo padrão do `ClinicalRecordsController`.
 */
describe('AppointmentsController — validação de UUID nos parâmetros', () => {
  let app: INestApplication;

  const appointmentsService = {
    findAgenda: jest.fn().mockResolvedValue({ total: 0, records: [] }),
    findByPatient: jest.fn().mockResolvedValue({ total: 0, records: [] }),
    findOne: jest.fn().mockResolvedValue({ id: 'ok' }),
    create: jest.fn().mockResolvedValue({ id: 'ok' }),
    update: jest.fn().mockResolvedValue({ id: 'ok' }),
    updateStatus: jest.fn().mockResolvedValue({ id: 'ok' }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const uuid = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        { provide: AppointmentsService, useValue: appointmentsService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Substitui o JwtAuthGuard global (vive no AppModule).
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

  it.each([
    ['get', '/appointments/naoehuuid', 'findOne'],
    ['get', '/appointments/patient/naoehuuid', 'findByPatient'],
    ['patch', '/appointments/naoehuuid', 'update'],
    ['patch', '/appointments/naoehuuid/status', 'updateStatus'],
    ['delete', '/appointments/naoehuuid', 'delete'],
  ] as const)(
    '%s %s responde 400 de validação sem chamar o service',
    async (metodo, rota, metodoDoService) => {
      const res = await request(app.getHttpServer())[metodo](rota).send({});

      expect(res.status).toBe(400);
      // A mensagem precisa dizer o que está errado — não o 400 genérico de
      // banco que o AllExceptionsFilter produzia.
      expect(JSON.stringify(res.body)).toContain('uuid');
      expect(appointmentsService[metodoDoService]).not.toHaveBeenCalled();
    },
  );

  it('continua atendendo um UUID válido', async () => {
    await request(app.getHttpServer()).get(`/appointments/${uuid}`).expect(200);

    expect(appointmentsService.findOne).toHaveBeenCalledWith(uuid, 'user-1');
  });

  it('continua atendendo o histórico de um paciente com UUID válido', async () => {
    await request(app.getHttpServer())
      .get(`/appointments/patient/${uuid}`)
      .expect(200);

    expect(appointmentsService.findByPatient).toHaveBeenCalledWith(
      uuid,
      'user-1',
    );
  });
});
