import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { PlatformErrorDailyRepository } from './platform-error-daily.repository';

describe('PlatformErrorDailyRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: Array<{ trecho: string; records: unknown[] }> = [];
  let repository: PlatformErrorDailyRepository;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
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
            structured ? { records, affected: 3 } : records,
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
    repository = new PlatformErrorDailyRepository(
      dataSource.getRepository('PlatformErrorDaily') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const ultima = () => consultas[consultas.length - 1];
  const filtro = { fromDay: '2026-10-01', toDay: '2026-10-28' };

  it('increment faz upsert atômico somando 1 na chave (conta, dia, origem, impressão)', async () => {
    const at = new Date('2026-10-28T12:00:00Z');
    await repository.increment({
      ownerId: 'o1',
      day: '2026-10-28',
      source: 'http',
      fingerprint: 'f'.repeat(64),
      errorClass: 'TypeError',
      route: 'GET /x/:id',
      occurredAt: at,
      message: 'falhou',
      requestId: 'req-1',
      traceId: 'tr-1',
      userId: 'u1',
    });
    const { sql, params } = ultima();
    expect(sql).toContain(
      'ON CONFLICT ON CONSTRAINT "UQ_platform_error_daily_key"',
    );
    expect(sql).toContain('"count" = "platform_error_daily"."count" + 1');
    expect(params).toEqual([
      'o1',
      '2026-10-28',
      'http',
      'f'.repeat(64),
      'TypeError',
      'GET /x/:id',
      at,
      'falhou',
      'req-1',
      'tr-1',
      'u1',
    ]);
  });

  it('topFingerprints agrupa por impressão, filtra período/origem/conta e pagina', async () => {
    respostas = [
      { trecho: 'COUNT(DISTINCT "e"."fingerprint")', records: [{ total: 4 }] },
      { trecho: 'COUNT(DISTINCT e.fingerprint)', records: [{ total: 4 }] },
      {
        trecho: 'array_agg',
        records: [
          {
            fingerprint: 'abc',
            source: 'http',
            total: '7',
            accounts: '2',
            lastSeenAt: new Date(),
          },
        ],
      },
    ];
    const page = await repository.topFingerprints({
      ...filtro,
      source: 'queue',
      ownerId: 'o1',
      limit: 10,
      offset: 20,
    });
    const { sql, params } = ultima();
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('"e"."day" >=');
    expect(sql).toContain('"e"."source" =');
    expect(sql).toContain('"e"."owner_id" =');
    expect(sql).toMatch(/LIMIT 10/);
    expect(sql).toMatch(/OFFSET 20/);
    expect(params).toEqual(
      expect.arrayContaining(['2026-10-01', '2026-10-28', 'queue', 'o1']),
    );
    expect(page.total).toBe(4);
    expect(page.items[0]).toMatchObject({ total: 7, accounts: 2 });
  });

  it('topAccounts ignora erros sem conta e traz o nome do dono', async () => {
    respostas = [
      {
        trecho: 'SUM("e"."count")',
        records: [
          { ownerId: 'o1', ownerName: 'A', total: '5', fingerprints: '2' },
        ],
      },
    ];
    const rows = await repository.topAccounts({ ...filtro, limit: 5 });
    expect(ultima().sql).toContain('"e"."owner_id" IS NOT NULL');
    expect(ultima().sql).toContain('"users"');
    expect(rows[0]).toMatchObject({ total: 5, fingerprints: 2 });
  });

  it('accountsWithSpike usa HAVING com o limiar e devolve o total de contas', async () => {
    respostas = [
      {
        trecho: 'HAVING',
        records: [
          { ownerId: 'o1', ownerName: 'A', total: '30' },
          { ownerId: 'o2', ownerName: 'B', total: '12' },
        ],
      },
    ];
    const since = new Date('2026-10-27T12:00:00Z');
    const result = await repository.accountsWithSpike(
      since,
      '2026-10-27',
      10,
      1,
    );
    expect(ultima().sql).toContain('HAVING SUM("e"."count") >=');
    expect(ultima().params).toEqual(
      expect.arrayContaining([since, '2026-10-27', 10]),
    );
    expect(result).toEqual({
      accounts: 2,
      top: [{ ownerId: 'o1', ownerName: 'A', total: 30 }],
    });
  });

  it('purgeBefore apaga pelo dia', async () => {
    await expect(repository.purgeBefore('2026-07-30')).resolves.toBe(0);
    expect(ultima().sql).toMatch(
      /DELETE FROM "platform_error_daily" WHERE "day" < \$1/,
    );
    expect(ultima().params).toEqual(['2026-07-30']);
  });
});
