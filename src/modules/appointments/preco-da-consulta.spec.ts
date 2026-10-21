import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { Permission } from 'src/shared/permissions';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ocultarPreco, podeVerPreco } from './preco-da-consulta';

describe('valor da consulta só para quem tem a área financeiro', () => {
  describe('ocultarPreco', () => {
    it('remove a chave price da lista paginada, da lista simples e do objeto', () => {
      const paginada = ocultarPreco({
        total: 1,
        records: [{ id: 'a', price: '10.00' }],
      });
      const simples = ocultarPreco([{ id: 'b', price: null }]);
      const unico = ocultarPreco({ id: 'c', price: '5.00' });

      expect(paginada.records[0]).not.toHaveProperty('price');
      expect(simples[0]).not.toHaveProperty('price');
      expect(unico).not.toHaveProperty('price');
      expect(unico).toEqual({ id: 'c' });
    });

    it('remove price em qualquer nível, inclusive em entidades e ciclos', () => {
      class Consulta {
        id = 'x';
        price: string | null = '10.00';
        scheduledAt = new Date('2026-10-20T10:00:00Z');
        retornoDe: unknown = null;
      }
      const raiz = new Consulta();
      const origem = new Consulta();
      raiz.retornoDe = origem;
      const entrada: {
        data: { itens: Consulta[]; extra: { appointment: object } };
        mapa: Map<string, object>;
        ciclo: unknown;
      } = {
        data: { itens: [raiz], extra: { appointment: { price: '1.00' } } },
        mapa: new Map([['a', { price: '2.00' }]]),
        ciclo: null,
      };
      const resposta = ocultarPreco(entrada);
      resposta.ciclo = resposta;
      ocultarPreco(resposta);
      expect(raiz).not.toHaveProperty('price');
      expect(origem).not.toHaveProperty('price');
      expect(raiz.scheduledAt).toBeInstanceOf(Date);
      expect(resposta.data.extra.appointment).toEqual({});
      expect(resposta.mapa.get('a')).toEqual({});
    });

    it('tolera resposta vazia', () => {
      expect(ocultarPreco(undefined)).toBeUndefined();
      expect(ocultarPreco(null)).toBeNull();
    });
  });

  it.each([
    [[Permission.FINANCEIRO], true],
    [
      [Permission.AGENDA, Permission.ATENDIMENTO, Permission.ADMINISTRACAO],
      false,
    ],
    [[], false],
    [undefined, false],
  ])('podeVerPreco(%p) → %p', (permissions, esperado) => {
    expect(podeVerPreco({ permissions })).toBe(esperado);
  });

  describe('respostas HTTP das rotas de consulta', () => {
    let app: INestApplication;
    let permissoes: Permission[] = [];

    const consulta = () => ({
      id: '44444444-4444-4444-8444-444444444444',
      status: 'scheduled',
      price: '300.00',
      returnOf: {
        id: '55555555-5555-4555-8555-555555555555',
        price: '250.00',
      },
      clinicalRecord: { appointment: { price: '300.00' } },
    });
    const service = {
      findAgenda: jest.fn(() =>
        Promise.resolve({ total: 1, records: [consulta()] }),
      ),
      findByPatient: jest.fn(() =>
        Promise.resolve({ total: 1, records: [consulta()] }),
      ),
      findOneComFicha: jest.fn(() => Promise.resolve(consulta())),
      create: jest.fn(() => Promise.resolve(consulta())),
      update: jest.fn(() => Promise.resolve(consulta())),
      updateStatus: jest.fn(() => Promise.resolve(consulta())),
      findActivities: jest.fn(() =>
        Promise.resolve([{ id: 'act-1', appointment: consulta() }]),
      ),
      addComment: jest.fn(() =>
        Promise.resolve({ id: 'act-2', appointment: consulta() }),
      ),
    };
    const uuid = '44444444-4444-4444-8444-444444444444';
    const corpoDeCriacao = {
      patientId: uuid,
      doctorId: uuid,
      scheduledAt: '2026-08-01T14:00:00.000Z',
      price: '300.00',
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AppointmentsController],
        providers: [{ provide: AppointmentsService, useValue: service }],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
        req.user = {
          userId: 'user-1',
          ownerId: 'owner-1',
          role: 'collaborator',
          permissions: permissoes,
        };
        next();
      });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => jest.clearAllMocks());

    const rotas: [string, 'get' | 'post' | 'patch', string, object | null][] = [
      ['lista da agenda', 'get', '/appointments', null],
      ['histórico do paciente', 'get', `/appointments/patient/${uuid}`, null],
      ['detalhe', 'get', `/appointments/${uuid}`, null],
      ['criação', 'post', '/appointments', corpoDeCriacao],
      ['edição', 'patch', `/appointments/${uuid}`, { price: '1.00' }],
      [
        'mudança de status',
        'patch',
        `/appointments/${uuid}/status`,
        { status: 'confirmed' },
      ],
    ];

    const rotasComAninhados: [string, 'get' | 'post', string, object | null][] =
      [
        [
          'histórico da consulta',
          'get',
          `/appointments/${uuid}/activities`,
          null,
        ],
        [
          'comentário no histórico',
          'post',
          `/appointments/${uuid}/activities`,
          { content: 'Ok' },
        ],
      ];

    it.each([...rotas, ...rotasComAninhados])(
      '%s não vaza price em nenhum nível sem a área financeiro',
      async (_nome, metodo, rota, corpo) => {
        permissoes = [Permission.AGENDA, Permission.ATENDIMENTO];
        const res = await request(app.getHttpServer())
          [metodo](rota)
          .send(corpo ?? {});

        expect(res.status).toBeLessThan(300);
        expect(JSON.stringify(res.body)).not.toContain('"price"');
        expect(JSON.stringify(res.body)).not.toContain('300.00');
      },
    );

    function consultasDe(body: unknown): Record<string, unknown>[] {
      const { records } = body as { records?: Record<string, unknown>[] };
      return records ?? [body as Record<string, unknown>];
    }

    it.each(rotas)(
      '%s não traz a chave price sem a área financeiro',
      async (_nome, metodo, rota, corpo) => {
        permissoes = [Permission.AGENDA, Permission.ATENDIMENTO];
        const res = await request(app.getHttpServer())
          [metodo](rota)
          .send(corpo ?? {});

        expect(res.status).toBeLessThan(300);
        for (const item of consultasDe(res.body)) {
          expect(item).not.toHaveProperty('price');
          expect(item.id).toBe(uuid);
        }
      },
    );

    it.each(rotas)(
      '%s traz o price para quem tem a área financeiro',
      async (_nome, metodo, rota, corpo) => {
        permissoes = [Permission.AGENDA, Permission.FINANCEIRO];
        const res = await request(app.getHttpServer())
          [metodo](rota)
          .send(corpo ?? {});

        expect(res.status).toBeLessThan(300);
        for (const item of consultasDe(res.body)) {
          expect(item.price).toBe('300.00');
        }
      },
    );

    it('repassa ao service se o usuário pode definir o valor', async () => {
      permissoes = [Permission.AGENDA];
      await request(app.getHttpServer())
        .post('/appointments')
        .send(corpoDeCriacao)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/appointments/${uuid}`)
        .send({ price: '1.00' })
        .expect(200);

      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ price: '300.00' }),
        'user-1',
        { podeDefinirPreco: false },
      );
      expect(service.update).toHaveBeenCalledWith(
        uuid,
        expect.objectContaining({ price: '1.00' }),
        'user-1',
        { podeDefinirPreco: false },
      );

      permissoes = [Permission.FINANCEIRO];
      await request(app.getHttpServer())
        .post('/appointments')
        .send(corpoDeCriacao)
        .expect(201);

      expect(service.create).toHaveBeenLastCalledWith(
        expect.anything(),
        'user-1',
        { podeDefinirPreco: true },
      );
    });
  });
});
