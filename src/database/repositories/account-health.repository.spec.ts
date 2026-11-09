import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { AccountHealthRepository } from './account-health.repository';

describe('AccountHealthRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: Array<{ trecho: string; records: unknown[] }> = [];
  let repository: AccountHealthRepository;

  const now = new Date('2026-10-28T15:00:00Z');
  const janela = {
    now,
    usageCurrentFrom: new Date('2026-10-21T15:00:00Z'),
    usagePreviousFrom: new Date('2026-10-14T15:00:00Z'),
    errorsFromDay: '2026-10-26',
    deliveryFrom: new Date('2026-10-25T15:00:00Z'),
  };

  beforeAll(async () => {
    const dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const runner = {
      connection: dataSource,
      manager: dataSource.manager,
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(
        (sql: string, params: unknown[] = [], structured?: boolean) => {
          consultas.push({ sql, params });
          const records =
            respostas.find((r) => sql.includes(r.trecho))?.records ?? [];
          return Promise.resolve(
            structured ? { records, affected: 2 } : records,
          );
        },
      ),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    jest
      .spyOn(dataSource.manager, 'query')
      .mockImplementation((sql: string, params?: unknown[]) => {
        consultas.push({ sql, params: params ?? [] });
        return Promise.resolve([]);
      });
    repository = new AccountHealthRepository(
      dataSource.getRepository('AccountHealthDaily') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const achar = (trecho: string) => {
    const c = consultas.find((q) => q.sql.includes(trecho));
    if (!c) throw new Error(`nenhuma consulta com ${trecho}`);
    return c;
  };

  describe('loadInputs', () => {
    it('junta tudo em consultas agregadas por conta, sem uma consulta por conta', async () => {
      respostas = [
        {
          trecho: 'FROM "subscriptions"',
          records: [
            {
              ownerId: 'o1',
              subscriptionId: 's-new',
              status: SubscriptionStatus.TRIALING,
              trialEndsAt: '2026-10-30T12:00:00Z',
              gatewaySubscriptionId: null,
              pastDueSince: null,
              ownerCreatedAt: '2026-08-01T12:00:00Z',
              deactivatedAt: null,
            },
            {
              ownerId: 'o1',
              subscriptionId: 's-old',
              status: SubscriptionStatus.CANCELED,
              trialEndsAt: null,
              gatewaySubscriptionId: 'sub_1',
              pastDueSince: null,
              ownerCreatedAt: '2026-08-01T12:00:00Z',
              deactivatedAt: null,
            },
            {
              ownerId: 'o2',
              subscriptionId: 's-2',
              status: SubscriptionStatus.PAST_DUE,
              trialEndsAt: null,
              gatewaySubscriptionId: 'sub_2',
              pastDueSince: '2026-10-20T12:00:00Z',
              ownerCreatedAt: '2026-01-01T12:00:00Z',
              deactivatedAt: '2026-10-27T12:00:00Z',
            },
          ],
        },
        {
          trecho: 'MAX("u"."last_seen_at")',
          records: [{ ownerId: 'o1', lastSeen: '2026-10-27T10:00:00Z' }],
        },
        {
          trecho: 'FROM "surgery_requests"',
          records: [{ ownerId: 'o1', current: '2', previous: '6' }],
        },
        {
          trecho: 'FROM "appointments"',
          records: [{ ownerId: 'o1', current: '1', previous: '4' }],
        },
        {
          trecho: 'FROM "platform_error_daily"',
          records: [{ ownerId: 'o2', total: '7' }],
        },
        {
          trecho: 'FROM "notification_send_logs"',
          records: [{ ownerId: 'o2', total: '3' }],
        },
        {
          trecho: 'FROM "subscription_quota_periods"',
          records: [{ subscriptionId: 's-new', used: 9, limit: 10 }],
        },
      ];

      const inputs = await repository.loadInputs(janela);

      expect(consultas).toHaveLength(7);
      expect(inputs).toEqual([
        {
          ownerId: 'o1',
          ownerCreatedAt: new Date('2026-08-01T12:00:00Z'),
          deactivated: false,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: new Date('2026-10-30T12:00:00Z'),
          hasGatewaySubscription: false,
          pastDueSince: null,
          lastSeenAt: new Date('2026-10-27T10:00:00Z'),
          usageCurrent: 3,
          usagePrevious: 10,
          quotaUsed: 9,
          quotaLimit: 10,
          errors: 0,
          deliveryFailures: 0,
        },
        {
          ownerId: 'o2',
          ownerCreatedAt: new Date('2026-01-01T12:00:00Z'),
          deactivated: true,
          status: SubscriptionStatus.PAST_DUE,
          trialEndsAt: null,
          hasGatewaySubscription: true,
          pastDueSince: new Date('2026-10-20T12:00:00Z'),
          lastSeenAt: null,
          usageCurrent: 0,
          usagePrevious: 0,
          quotaUsed: null,
          quotaLimit: null,
          errors: 7,
          deliveryFailures: 3,
        },
      ]);
    });

    it('janelas: uso pelo createdAt, erros a partir do dia, só envios com falha', async () => {
      await repository.loadInputs(janela);

      const sr = achar('FROM "surgery_requests"');
      expect(sr.sql).toMatch(/COUNT\(\*\) FILTER \(WHERE "sr"."created_at" >=/);
      expect(sr.params).toEqual(
        expect.arrayContaining([
          janela.usageCurrentFrom,
          janela.usagePreviousFrom,
          now,
        ]),
      );
      expect(achar('FROM "platform_error_daily"').params).toContain(
        '2026-10-26',
      );
      const envios = achar('FROM "notification_send_logs"');
      expect(envios.params).toEqual(
        expect.arrayContaining(['failed', janela.deliveryFrom]),
      );
      expect(achar('FROM "subscriptions"').sql).toContain(
        '"o"."owner_id" = "o"."id"',
      );
    });

    it('restringe às contas pedidas em todas as consultas', async () => {
      await repository.loadInputs(janela, ['o1']);
      for (const c of consultas) {
        expect(c.params).toContain('o1');
      }
    });

    it('lista vazia de contas não consulta nada', async () => {
      await expect(repository.loadInputs(janela, [])).resolves.toEqual([]);
      expect(consultas).toHaveLength(0);
    });
  });

  it('upsertMany grava todas as contas num único INSERT com ON CONFLICT na chave (conta, dia)', async () => {
    const computedAt = now;
    await repository.upsertMany([
      {
        ownerId: 'o1',
        day: '2026-10-28',
        score: 80,
        band: 'healthy',
        factors: [{ key: 'errors', points: 20, message: 'x' }],
        computedAt,
      },
      {
        ownerId: 'o2',
        day: '2026-10-28',
        score: 30,
        band: 'risk',
        factors: [],
        computedAt,
      },
    ]);

    expect(consultas).toHaveLength(1);
    const { sql, params } = consultas[0];
    expect(sql).toContain('ON CONFLICT ("owner_id", "day") DO UPDATE');
    expect(sql).toContain('$11::jsonb');
    expect(params).toEqual([
      'o1',
      '2026-10-28',
      80,
      'healthy',
      JSON.stringify([{ key: 'errors', points: 20, message: 'x' }]),
      computedAt,
      'o2',
      '2026-10-28',
      30,
      'risk',
      '[]',
      computedAt,
    ]);
  });

  it('upsertMany sem linhas não consulta', async () => {
    await repository.upsertMany([]);
    expect(consultas).toHaveLength(0);
  });

  it('latestForOwners e topAtRisk olham só o último dia calculado', async () => {
    await repository.latestForOwners(['o1']);
    expect(consultas[0].sql).toContain(
      'SELECT MAX(hd.day) FROM account_health_daily hd',
    );

    await repository.topAtRisk(5);
    const top = consultas[consultas.length - 1].sql;
    expect(top).toContain('"h"."band" = \'risk\'');
    expect(top).toContain('SELECT MAX(hd.day) FROM account_health_daily hd');
    expect(top).toMatch(/ORDER BY "h_score" ASC/);
  });

  it('deleteDayExcept tira do dia quem saiu da avaliação (inclusive com lista vazia)', async () => {
    await repository.deleteDayExcept('2026-10-28', ['o1', 'o2']);
    const { sql, params } = consultas[0];
    expect(sql).toContain('DELETE FROM "account_health_daily"');
    expect(sql).toContain('NOT ("owner_id" = ANY($2::uuid[]))');
    expect(params).toEqual(['2026-10-28', ['o1', 'o2']]);
  });

  it('purgeBefore apaga os dias antigos', async () => {
    await repository.purgeBefore('2026-07-30');
    expect(consultas[0].sql).toContain('WHERE "day" < $1');
    expect(consultas[0].params).toEqual(['2026-07-30']);
  });
});
