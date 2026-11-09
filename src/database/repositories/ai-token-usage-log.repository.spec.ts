import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { AiTokenUsageLogRepository } from './ai-token-usage-log.repository';

describe('AiTokenUsageLogRepository.report', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let rawRows: Array<Record<string, unknown>> = [];
  let repo: AiTokenUsageLogRepository;

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
        return Promise.resolve({ records: rawRows });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repo = new AiTokenUsageLogRepository(
      dataSource.getRepository('AiTokenUsageLog') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    rawRows = [];
  });

  function ultima(): { sql: string; params: unknown[] } {
    const c = consultas[consultas.length - 1];
    if (!c) throw new Error('nenhuma consulta executada');
    return c;
  }

  it('agrupa por dia por padrão, sem join e sem filtros', async () => {
    await repo.report({});

    const { sql, params } = ultima();
    expect(sql).toContain(
      `DATE("log"."created_at" AT TIME ZONE 'America/Sao_Paulo')::text`,
    );
    expect(sql).not.toContain('LEFT JOIN');
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  it('agrupa por usuário com nome e e-mail e mais nenhum campo do usuário', async () => {
    await repo.report({ groupBy: 'user' });

    const { sql } = ultima();
    expect(sql).toContain(
      'LEFT JOIN "users" "u" ON  "u"."id" = "log"."user_id"',
    );
    expect(sql).toContain('"u"."name"');
    expect(sql).toContain('"u"."email"');
    expect(sql).not.toContain('"u"."phone"');
    expect(sql).not.toContain('"u"."cpf"');
    expect(sql).toContain(`COALESCE("log"."user_id"::text, 'anonymous')`);
  });

  it('agrupa por conta juntando o dono em owner_id', async () => {
    await repo.report({ groupBy: 'owner' });

    const { sql } = ultima();
    expect(sql).toContain(
      'LEFT JOIN "users" "u" ON  "u"."id" = "log"."owner_id"',
    );
    expect(sql).toContain(`COALESCE("log"."owner_id"::text, 'none')`);
  });

  it('agrupa por modelo sem join', async () => {
    await repo.report({ groupBy: 'model' });

    const { sql } = ultima();
    expect(sql).toContain(`COALESCE("log"."model", 'unknown')`);
    expect(sql).not.toContain('LEFT JOIN');
  });

  it.each(['user', 'owner', 'model', 'day'] as const)(
    'combina ownerId, source e período com groupBy=%s',
    async (groupBy) => {
      await repo.report({
        groupBy,
        ownerId: '11111111-1111-1111-1111-111111111111',
        source: 'document_extraction',
        from: '2026-10-01',
        to: '2026-10-31',
      });

      const { sql, params } = ultima();
      expect(sql).toContain('"log"."created_at" >= $1');
      expect(sql).toContain('"log"."created_at" <= $2');
      expect(sql).toContain('"log"."owner_id" = $3');
      expect(sql).toContain('"log"."source" = $4');
      expect(params).toEqual([
        '2026-10-01',
        '2026-10-31',
        '11111111-1111-1111-1111-111111111111',
        'document_extraction',
      ]);
    },
  );

  it('filtra só por origem quando é o único filtro', async () => {
    await repo.report({ source: 'rag_embedding' });

    const { sql, params } = ultima();
    expect(sql).toContain('"log"."source" = $1');
    expect(params).toEqual(['rag_embedding']);
  });

  it('converte as linhas e devolve costUsdCents', async () => {
    rawRows = [
      {
        groupKey: 'u1',
        name: 'Dra. Ana',
        email: 'ana@x.com',
        totalPromptTokens: '1200',
        totalCompletionTokens: '800',
        totalTokens: '2000',
        totalCalls: '5',
        totalRecords: '3',
        totalCostCents: '7',
        avgLatencyMs: '450.4',
      },
      {
        groupKey: 'gpt-4o',
        name: null,
        email: null,
        totalPromptTokens: null,
        totalCompletionTokens: null,
        totalTokens: null,
        totalCalls: null,
        totalRecords: '0',
        totalCostCents: null,
        avgLatencyMs: null,
      },
    ];

    const result = await repo.report({ groupBy: 'user' });

    expect(result[0]).toEqual({
      groupKey: 'u1',
      name: 'Dra. Ana',
      email: 'ana@x.com',
      totalPromptTokens: 1200,
      totalCompletionTokens: 800,
      totalTokens: 2000,
      totalCalls: 5,
      totalRecords: 3,
      costUsdCents: 7,
      avgLatencyMs: 450,
    });
    expect(result[1].costUsdCents).toBeNull();
    expect(result[1].avgLatencyMs).toBeNull();
    expect(result[1].totalTokens).toBe(0);
  });
  describe('custo para o dashboard do painel', () => {
    const mes = {
      from: new Date('2026-10-01T03:00:00Z'),
      to: new Date('2026-10-24T15:00:00Z'),
    };
    const desde30 = new Date('2026-09-24T15:00:00Z');

    it('costSummary soma o mês das contas cliente, o mês de toda a plataforma e os últimos 30 dias das contas cliente', async () => {
      rawRows = [
        { clientMonth: '1234', platformMonth: '1500', clientLast30: '1400' },
      ];

      const result = await repo.costSummary(mes, desde30);

      const { sql, params } = ultima();
      expect(sql).toContain('SUM("log"."cost_estimate_cents") FILTER');
      expect(sql).toContain("cs.status <> 'internal'");
      expect(sql).toContain('co.owner_id = co.id');
      expect(sql).not.toContain('"log"."source"');
      expect(params).toEqual(
        expect.arrayContaining([mes.from, mes.to, desde30]),
      );
      expect(result).toEqual({
        clientMonthUsdCents: 1234,
        platformMonthUsdCents: 1500,
        clientLast30DaysUsdCents: 1400,
      });
    });

    it('costSummary sem registros devolve zeros', async () => {
      rawRows = [
        { clientMonth: null, platformMonth: null, clientLast30: null },
      ];

      expect(await repo.costSummary(mes, desde30)).toEqual({
        clientMonthUsdCents: 0,
        platformMonthUsdCents: 0,
        clientLast30DaysUsdCents: 0,
      });
    });

    it('topOwnersByCost ordena pelo custo, só contas cliente, com limite', async () => {
      rawRows = [
        {
          ownerId: 'o1',
          name: 'Clínica A',
          email: 'a@x.com',
          cost: '900',
          tokens: '120000',
        },
      ];

      const result = await repo.topOwnersByCost(mes, 5);

      const { sql, params } = ultima();
      expect(sql).toContain('INNER JOIN "users" "ow"');
      expect(sql).toContain("cs.status <> 'internal'");
      expect(sql).toMatch(/ORDER BY "cost" DESC/);
      expect(sql).toContain('LIMIT 5');
      expect(params).toEqual(expect.arrayContaining([mes.from, mes.to]));
      expect(result).toEqual([
        {
          ownerId: 'o1',
          name: 'Clínica A',
          email: 'a@x.com',
          costUsdCents: 900,
          totalTokens: 120000,
        },
      ]);
    });
  });
});
