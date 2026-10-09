import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsController — validação de UUID nos parâmetros', () => {
  let app: INestApplication;

  const appointmentsService = {
    findAgenda: jest.fn().mockResolvedValue({ total: 0, records: [] }),
    findByPatient: jest.fn().mockResolvedValue({ total: 0, records: [] }),
    findOneComFicha: jest.fn().mockResolvedValue({ id: 'ok' }),
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
    ['get', '/appointments/naoehuuid', 'findOneComFicha'],
    ['get', '/appointments/patient/naoehuuid', 'findByPatient'],
    ['patch', '/appointments/naoehuuid', 'update'],
    ['patch', '/appointments/naoehuuid/status', 'updateStatus'],
    ['delete', '/appointments/naoehuuid', 'delete'],
  ] as const)(
    '%s %s responde 400 de validação sem chamar o service',
    async (metodo, rota, metodoDoService) => {
      const res = await request(app.getHttpServer())[metodo](rota).send({});

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('uuid');
      expect(appointmentsService[metodoDoService]).not.toHaveBeenCalled();
    },
  );

  it('continua atendendo um UUID válido', async () => {
    await request(app.getHttpServer()).get(`/appointments/${uuid}`).expect(200);

    expect(appointmentsService.findOneComFicha).toHaveBeenCalledWith(
      uuid,
      'user-1',
    );
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
