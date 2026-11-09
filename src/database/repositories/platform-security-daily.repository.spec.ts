import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { PlatformSecurityDailyRepository } from './platform-security-daily.repository';

describe('PlatformSecurityDailyRepository', () => {
  let repository: PlatformSecurityDailyRepository;
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: Array<{ trecho: string; records: unknown[] }> = [];
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
        return Promise.resolve([{ count: 2 }]);
      });
    repository = new PlatformSecurityDailyRepository(
      dataSource.getRepository('PlatformSecurityDaily') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const ultima = () => consultas[consultas.length - 1];

  const filtro = { fromDay: '2026-10-01', toDay: '2026-10-28' };

  it('increment faz upsert atômico somando 1 na chave (conta, usuário, dia, evento)', async () => {
    const at = new Date('2026-10-28T12:00:00Z');
    await repository.increment({
      ownerId: 'o1',
      userId: 'u1',
      day: '2026-10-28',
      eventType: 'login_failed',
      occurredAt: at,
      requestId: 'req-1',
    });
    const { sql, params } = ultima();
    expect(sql).toContain(
      'ON CONFLICT ON CONSTRAINT "UQ_platform_security_daily_key"',
    );
    expect(sql).toContain('"count" = "platform_security_daily"."count" + 1');
    expect(params).toEqual([
      'o1',
      'u1',
      '2026-10-28',
      'login_failed',
      at,
      'req-1',
    ]);
  });

  it('a tabela não tem coluna para e-mail nem IP', () => {
    const colunas = dataSource
      .getMetadata('PlatformSecurityDaily')
      .columns.map((c) => c.databaseName);
    expect(colunas).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/email|ip/)]),
    );
  });

  it('identityByEmail compara sem diferenciar maiúsculas e só lê id e dono', async () => {
    respostas = [
      { trecho: 'lower', records: [{ userId: 'u1', ownerId: 'o1' }] },
    ];
    const identity = await repository.identityByEmail('Ana@X.com');
    const { sql, params } = ultima();
    expect(sql).toContain('lower("u"."email") = lower(');
    expect(sql).not.toContain('password');
    expect(params).toContain('Ana@X.com');
    expect(identity).toEqual({ userId: 'u1', ownerId: 'o1' });
  });

  it('totalsByType agrupa por evento e filtra conta e tipos', async () => {
    respostas = [
      {
        trecho: 'GROUP BY',
        records: [{ eventType: 'login_failed', total: '7' }],
      },
    ];
    const rows = await repository.totalsByType({
      ...filtro,
      ownerId: 'o1',
      eventTypes: ['login_failed'],
    });
    const { sql, params } = ultima();
    expect(sql).toContain('"s"."owner_id" =');
    expect(sql).toContain('"s"."event_type" IN');
    expect(params).toEqual(
      expect.arrayContaining([
        '2026-10-01',
        '2026-10-28',
        'o1',
        'login_failed',
      ]),
    );
    expect(rows).toEqual([{ eventType: 'login_failed', total: 7 }]);
  });

  it('topAccounts ignora eventos sem conta e traz o nome do dono', async () => {
    respostas = [
      {
        trecho: 'SUM("s"."count")',
        records: [{ ownerId: 'o1', ownerName: 'A', total: '5', users: '2' }],
      },
    ];
    const rows = await repository.topAccounts({ ...filtro, limit: 5 });
    expect(ultima().sql).toContain('"s"."owner_id" IS NOT NULL');
    expect(ultima().sql).toMatch(/LIMIT 5/);
    expect(rows[0]).toMatchObject({ total: 5, users: 2 });
  });

  it('loginFailuresSince soma só falhas das últimas 24 h e lista as contas', async () => {
    respostas = [
      { trecho: 'COALESCE', records: [{ total: '60' }] },
      {
        trecho: 'GROUP BY',
        records: [{ ownerId: 'o1', ownerName: 'A', total: '12', users: '1' }],
      },
    ];
    const since = new Date('2026-10-27T12:00:00Z');
    const result = await repository.loginFailuresSince(since, '2026-10-27');
    const { sql, params } = ultima();
    expect(sql).toContain('"s"."last_seen_at" >=');
    expect(params).toEqual(
      expect.arrayContaining(['login_failed', 'login_locked', 'mfa_failed']),
    );
    expect(params).not.toContain('password_changed');
    expect(result).toEqual({
      total: 60,
      accounts: [{ ownerId: 'o1', ownerName: 'A', total: 12, users: 1 }],
    });
  });

  it('mfaCoverage conta usuários ativos sem MFA, opcionalmente por conta', async () => {
    respostas = [
      { trecho: 'FILTER', records: [{ activeUsers: '8', withoutMfa: '3' }] },
    ];
    const coverage = await repository.mfaCoverage('o1');
    expect(ultima().sql).toContain('"u"."mfa_enabled_at" IS NULL');
    expect(ultima().params).toContain('o1');
    expect(coverage).toEqual({ activeUsers: 8, withoutMfa: 3 });
  });

  it('purgeBefore apaga pelo dia', async () => {
    const removidas = await repository.purgeBefore('2026-07-30');
    expect(ultima().sql).toContain('DELETE FROM "platform_security_daily"');
    expect(ultima().params).toEqual(['2026-07-30']);
    expect(removidas).toBe(2);
  });
});
