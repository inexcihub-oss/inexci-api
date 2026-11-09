import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { AdminAccountsRepository } from './admin-accounts.repository';
import { AdminUsageRepository } from './admin-usage.repository';

describe('AdminUsageRepository e consultas de contas ativas e inativas', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let usage: AdminUsageRepository;
  let accounts: AdminAccountsRepository;
  const range = {
    from: new Date('2026-09-01T03:00:00Z'),
    to: new Date('2026-10-01T03:00:00Z'),
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
      query: jest.fn((sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        return Promise.resolve({
          records: sql.includes('COUNT') ? [{ count: '0', cnt: '0' }] : [],
        });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    usage = new AdminUsageRepository(
      dataSource.getRepository('Subscription') as never,
    );
    accounts = new AdminAccountsRepository(
      dataSource.getRepository('Subscription') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
  });

  function ultima(): { sql: string; params: unknown[] } {
    const c = consultas[consultas.length - 1];
    if (!c) throw new Error('nenhuma consulta executada');
    return c;
  }

  it('agrupa a série semanal no fuso de São Paulo', async () => {
    await usage.weeklySurgeryRequestsCreated(range);

    const { sql } = ultima();
    expect(sql).toContain("date_trunc('week'");
    expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    expect(sql).toContain('created_at');
  });

  it.each([
    ['weeklySurgeryRequestsSent', 'sent_at'],
    ['weeklyAppointmentsByStatus', 'scheduled_at'],
    ['weeklyPatientsCreated', 'created_at'],
    ['weeklyRecordsFinalized', 'finalized_at'],
  ] as const)(
    '%s usa a coluna %s e restringe às contas cliente',
    async (metodo, coluna) => {
      await usage[metodo](range);

      const { sql, params } = ultima();
      expect(sql).toContain(coluna);
      expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
      expect(sql).toContain("status <> 'internal'");
      expect(sql).toContain('co.owner_id = co.id');
      expect(sql).toContain('co.deleted_at IS NULL');
      expect(params).toEqual(expect.arrayContaining([range.from, range.to]));
    },
  );

  it('séries de pacientes e fichas ignoram registros excluídos', async () => {
    await usage.weeklyPatientsCreated(range);
    expect(ultima().sql).toContain('"pt"."deleted_at" IS NULL');

    await usage.weeklyRecordsFinalized(range);
    expect(ultima().sql).toContain('"cr"."deleted_at" IS NULL');
  });

  it('ranking de SCs ordena por contagem, limita e traz nome e e-mail', async () => {
    await usage.topBySurgeryRequests(range, 10);

    const { sql } = ultima();
    expect(sql).toContain('surgery_requests');
    expect(sql).toMatch(/ORDER BY "count" DESC/);
    expect(sql).toContain('"ow"."name"');
    expect(sql).toContain('"ow"."email"');
    expect(sql).toContain("status <> 'internal'");
    expect(sql).toContain('LIMIT 10');
  });

  it('ranking de consultas conta pela data da consulta', async () => {
    await usage.topByAppointments(range, 10);

    const { sql } = ultima();
    expect(sql).toContain('appointments');
    expect(sql).toContain('scheduled_at');
    expect(sql).toMatch(/ORDER BY "count" DESC/);
  });

  it('contas inativas excluem acesso interno e canceladas e usam o último acesso sem usuários excluídos', async () => {
    const now = new Date('2026-10-23T15:00:00Z');
    await accounts.findInactiveClients(7, now, 50);

    const sqls = consultas.map((c) => c.sql).join('\n');
    expect(sqls).toContain('lu.deleted_at IS NULL');
    expect(sqls).toContain('"s"."status" NOT IN ($');
    expect(
      consultas.some(
        (c) => c.params.includes('internal') && c.params.includes('canceled'),
      ),
    ).toBe(true);
    const limite = consultas.find((c) =>
      c.params.some(
        (p) =>
          p instanceof Date &&
          p.getTime() === now.getTime() - 7 * 24 * 60 * 60 * 1000,
      ),
    );
    expect(limite).toBeDefined();
    expect(sqls).toContain('"o"."owner_id" = "o"."id"');
  });

  it('contagem de contas inativas usa a mesma regra da lista, sem internas nem canceladas', async () => {
    const now = new Date('2026-10-23T15:00:00Z');
    await accounts.countInactiveClients(7, now);

    const { sql, params } = ultima();
    expect(sql).toContain('COUNT(DISTINCT');
    expect(sql).toContain('"s"."status" NOT IN ($');
    expect(sql).toContain('lu.last_seen_at');
    expect(params).toEqual(
      expect.arrayContaining([
        'internal',
        'canceled',
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      ]),
    );
  });

  it('contagem de contas ativas filtra por último acesso e exclui acesso interno', async () => {
    const since = new Date('2026-10-16T15:00:00Z');
    await accounts.countClientsSeenSince(since);

    const { sql, params } = ultima();
    expect(sql).toContain('COUNT(DISTINCT');
    expect(sql).toContain('lu.last_seen_at');
    expect(sql).toContain('"s"."status" <> $');
    expect(params).toContain(since);
  });
});
