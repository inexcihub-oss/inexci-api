import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { AdminMetricsRepository } from './admin-metrics.repository';

describe('AdminMetricsRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: Array<{ trecho: string; records: unknown[] }> = [];
  let repository: AdminMetricsRepository;
  const range = {
    from: new Date('2026-10-01T03:00:00Z'),
    to: new Date('2026-10-24T15:00:00Z'),
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
          return Promise.resolve(structured ? { records } : records);
        },
      ),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repository = new AdminMetricsRepository(
      dataSource.getRepository('Subscription') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const ultima = () => {
    const c = consultas[consultas.length - 1];
    if (!c) throw new Error('nenhuma consulta executada');
    return c;
  };

  const universoCliente = (sql: string) => {
    expect(sql).toContain("cs.status <> 'internal'");
    expect(sql).toContain('co.owner_id = co.id');
    expect(sql).toContain('co.deleted_at IS NULL');
  };

  describe('countCreatedBetween', () => {
    it('conta assinaturas de contas cliente criadas no intervalo, fora acesso interno', async () => {
      respostas = [{ trecho: 'COUNT(*)', records: [{ count: '7' }] }];

      const total = await repository.countCreatedBetween(range);

      const { sql, params } = ultima();
      universoCliente(sql);
      expect(sql).toContain('"s"."created_at" >= $');
      expect(sql).toContain('"s"."created_at" < $');
      expect(params).toEqual(expect.arrayContaining([range.from, range.to]));
      expect(total).toBe(7);
    });

    it('sem início conta tudo o que foi criado antes do fim', async () => {
      await repository.countCreatedBetween({ to: range.to });

      const { sql } = ultima();
      expect(sql).not.toContain('"s"."created_at" >= $');
      expect(sql).toContain('"s"."created_at" < $');
    });
  });

  describe('countCanceledBetween', () => {
    it('conta só status cancelado com canceled_at no intervalo', async () => {
      respostas = [{ trecho: 'COUNT(*)', records: [{ count: '2' }] }];

      const total = await repository.countCanceledBetween(range);

      const { sql, params } = ultima();
      universoCliente(sql);
      expect(sql).toContain('"s"."canceled_at" >= $');
      expect(sql).toContain('"s"."canceled_at" < $');
      expect(params).toEqual(expect.arrayContaining(['canceled']));
      expect(total).toBe(2);
    });
  });

  describe('trialCohort', () => {
    it('iniciados, com cartão (assinatura na Stripe) e convertidos (fatura paga acima de zero)', async () => {
      respostas = [
        {
          trecho: 'gateway_invoices',
          records: [{ started: '10', withCard: '6', converted: '4' }],
        },
      ];

      const cohort = await repository.trialCohort(range);

      const { sql } = ultima();
      universoCliente(sql);
      expect(sql).toContain('"s"."gateway_subscription_id" IS NOT NULL');
      expect(sql).toContain("pi.status = 'paid'");
      expect(sql).toContain('pi.amount_paid_cents > 0');
      expect(sql).toContain('pi.owner_id = "s"."owner_id"');
      expect(cohort).toEqual({ started: 10, withCard: 6, converted: 4 });
    });

    it('sem linhas devolve zeros', async () => {
      expect(await repository.trialCohort(range)).toEqual({
        started: 0,
        withCard: 0,
        converted: 0,
      });
    });
  });

  describe('findPayingCanceledBetween', () => {
    it('canceladas no intervalo que já tinham pago uma fatura antes do início', async () => {
      await repository.findPayingCanceledBetween(range);

      const { sql, params } = ultima();
      universoCliente(sql);
      expect(sql).toContain('"s"."canceled_at" >= $');
      expect(sql).toContain('pi.paid_at < $');
      expect(sql).toContain('pi.amount_paid_cents > 0');
      expect(sql).toContain('"subscription_plans"');
      expect(params).toEqual(
        expect.arrayContaining(['canceled', range.from, range.to]),
      );
    });
  });

  describe('séries mensais', () => {
    it('agrupa criadas por mês no fuso de São Paulo', async () => {
      respostas = [
        {
          trecho: 'to_char',
          records: [
            { month: '2026-09', count: '3' },
            { month: '2026-10', count: '5' },
          ],
        },
      ];

      const rows = await repository.monthlyCreated(range.from);

      const { sql } = ultima();
      universoCliente(sql);
      expect(sql).toContain(
        `to_char("s"."created_at" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      );
      expect(rows).toEqual([
        { month: '2026-09', count: 3 },
        { month: '2026-10', count: 5 },
      ]);
    });

    it('agrupa canceladas por mês pelo canceled_at', async () => {
      await repository.monthlyCanceled(range.from);

      const { sql, params } = ultima();
      universoCliente(sql);
      expect(sql).toContain(
        `to_char("s"."canceled_at" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      );
      expect(params).toEqual(expect.arrayContaining(['canceled']));
    });
  });

  describe('accountsByPlan', () => {
    it('conta contas cliente não canceladas por plano', async () => {
      respostas = [
        {
          trecho: 'GROUP BY',
          records: [
            {
              planId: 'p1',
              planName: 'Starter',
              billingPeriod: 'MONTHLY',
              accounts: '4',
            },
          ],
        },
      ];

      const rows = await repository.accountsByPlan();

      const { sql, params } = ultima();
      universoCliente(sql);
      expect(sql).toContain('"s"."status" NOT IN');
      expect(params).toEqual(expect.arrayContaining(['canceled', 'internal']));
      expect(rows).toEqual([
        {
          planId: 'p1',
          planName: 'Starter',
          billingPeriod: 'MONTHLY',
          accounts: 4,
        },
      ]);
    });
  });

  describe('reconstructMrrAt', () => {
    it('usa a última fatura paga de cada conta dentro do ciclo, fora contas canceladas antes da data', async () => {
      respostas = [
        { trecho: 'DISTINCT ON', records: [{ mrr: '54816', paying: '3' }] },
      ];
      const at = new Date('2026-09-01T03:00:00Z');

      const result = await repository.reconstructMrrAt(at);

      const { sql, params } = ultima();
      expect(sql).toContain('DISTINCT ON (gi.owner_id)');
      expect(sql).toContain('gi.amount_paid_cents > 0');
      expect(sql).toContain("INTERVAL '35 days'");
      expect(sql).toContain("INTERVAL '370 days'");
      expect(sql).toContain('FLOOR(gi.amount_paid_cents / 12.0)');
      expect(sql).toContain("s.status = 'canceled'");
      expect(sql).toContain("cs.status <> 'internal'");
      expect(params).toEqual([at]);
      expect(result).toEqual({ mrrCents: 54816, payingAccounts: 3 });
    });
  });

  describe('snapshots', () => {
    const linha = {
      day: '2026-10-23',
      accountsTotal: 40,
      accountsBySituation: { trial: 5, active: 30 },
      mrrCents: 897000,
      payingAccounts: 30,
      trialAccounts: 5,
      newAccounts: 2,
      canceledAccounts: 1,
      activeAccounts7d: 22,
      activeAccounts30d: 33,
    };

    it('upsertSnapshot é idempotente por dia: ON CONFLICT ("day") DO UPDATE de todas as colunas', async () => {
      await repository.upsertSnapshot(linha);

      const { sql, params } = ultima();
      expect(sql).toContain('INSERT INTO "platform_metrics_daily"');
      expect(sql).toContain('ON CONFLICT ("day") DO UPDATE SET');
      expect(sql).toContain('"mrr_cents" = EXCLUDED."mrr_cents"');
      expect(sql).toContain(
        '"active_accounts_30d" = EXCLUDED."active_accounts_30d"',
      );
      expect(sql).not.toContain('WHERE');
      expect(params).toEqual([
        '2026-10-23',
        40,
        JSON.stringify({ trial: 5, active: 30 }),
        897000,
        30,
        5,
        2,
        1,
        22,
        33,
      ]);
    });

    it('a reconstrução nunca sobrescreve um dia gravado pelo cron (só linhas sem contas ativas)', async () => {
      respostas = [{ trecho: 'RETURNING', records: [] }];

      const written = await repository.upsertReconstructedSnapshot({
        ...linha,
        accountsBySituation: null,
        trialAccounts: null,
        activeAccounts7d: null,
        activeAccounts30d: null,
      });

      const { sql, params } = ultima();
      expect(sql).toContain('ON CONFLICT ("day") DO UPDATE SET');
      expect(sql).toContain(
        'WHERE "platform_metrics_daily"."active_accounts_30d" IS NULL',
      );
      expect(params[2]).toBeNull();
      expect(params[8]).toBeNull();
      expect(written).toBe(false);
    });

    it('findSnapshotsBetween ordena pelo dia', async () => {
      await repository.findSnapshotsBetween('2025-10-01', '2026-10-24');

      const { sql, params } = ultima();
      expect(sql).toContain('"platform_metrics_daily"');
      expect(sql).toContain('ORDER BY "m"."day" ASC');
      expect(params).toEqual(
        expect.arrayContaining(['2025-10-01', '2026-10-24']),
      );
    });
  });
});
