import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { AdminRevenueRepository } from './admin-revenue.repository';

describe('AdminRevenueRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: Array<{ trecho: string; records: unknown[] }> = [];
  let repository: AdminRevenueRepository;

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
        const resposta = respostas.find((r) => sql.includes(r.trecho));
        if (resposta) return Promise.resolve({ records: resposta.records });
        return Promise.resolve({
          records: sql.includes('COUNT(DISTINCT') ? [{ cnt: '0' }] : [],
        });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repository = new AdminRevenueRepository(
      dataSource.getRepository('GatewayInvoice') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const ultima = (trecho: string) => {
    const achada = [...consultas].reverse().find((c) => c.sql.includes(trecho));
    if (!achada) throw new Error(`nenhuma consulta com ${trecho}`);
    return achada;
  };

  const from = new Date('2026-10-01T03:00:00Z');
  const to = new Date('2026-11-01T03:00:00Z');

  describe('sumPaidBetween', () => {
    it('soma pago e desconto das faturas pagas no intervalo, fora acesso interno', async () => {
      respostas = [
        {
          trecho: 'SUM("gi"."amount_paid_cents")',
          records: [{ received: '53820', discount: '5980', invoices: '2' }],
        },
      ];

      const result = await repository.sumPaidBetween(from, to);

      const { sql, params } = ultima('SUM("gi"."amount_paid_cents")');
      expect(sql).toContain('"gi"."status" = $');
      expect(sql).toContain('"gi"."paid_at" >= $');
      expect(sql).toContain('"gi"."paid_at" < $');
      expect(sql).toContain("xs.status = 'internal'");
      expect(params).toEqual(expect.arrayContaining(['paid', from, to]));
      expect(result).toEqual({
        receivedCents: 53820,
        discountCents: 5980,
        invoices: 2,
      });
    });

    it('sem faturas devolve zero', async () => {
      respostas = [
        {
          trecho: 'SUM("gi"."amount_paid_cents")',
          records: [{ received: null, discount: null, invoices: '0' }],
        },
      ];
      expect(await repository.sumPaidBetween(from, to)).toEqual({
        receivedCents: 0,
        discountCents: 0,
        invoices: 0,
      });
    });
  });

  describe('receivedByMonth', () => {
    it('agrupa por mês no fuso de SP', async () => {
      respostas = [
        {
          trecho: 'GROUP BY',
          records: [
            { month: '2026-09', received: '29900' },
            { month: '2026-10', received: '53820' },
          ],
        },
      ];

      const result = await repository.receivedByMonth(from, to);

      const { sql, params } = ultima('GROUP BY');
      expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
      expect(sql).toContain("'YYYY-MM'");
      expect(params).toEqual(expect.arrayContaining(['paid', from, to]));
      expect(result).toEqual([
        { month: '2026-09', receivedCents: 29900 },
        { month: '2026-10', receivedCents: 53820 },
      ]);
    });
  });

  describe('openTotals', () => {
    it('soma o que falta pagar das faturas abertas, fora acesso interno', async () => {
      respostas = [
        {
          trecho: '"gi"."amount_due_cents" - "gi"."amount_paid_cents"',
          records: [{ amount: '39800', invoices: '2' }],
        },
      ];

      const result = await repository.openTotals();

      const { sql, params } = ultima(
        '"gi"."amount_due_cents" - "gi"."amount_paid_cents"',
      );
      expect(params).toContain('open');
      expect(sql).toContain("xs.status = 'internal'");
      expect(result).toEqual({ amountCents: 39800, invoices: 2 });
    });
  });

  describe('outstandingByOwner', () => {
    it('agrupa por conta o que falta pagar das faturas abertas e incobráveis', async () => {
      respostas = [
        {
          trecho: 'GROUP BY "gi"."owner_id"',
          records: [{ ownerId: 'o1', amount: '39800', invoices: '2' }],
        },
      ];

      const result = await repository.outstandingByOwner(['o1', 'o2']);

      const { sql, params } = ultima('GROUP BY "gi"."owner_id"');
      expect(sql).toContain('"gi"."status" IN (');
      expect(sql).toContain(
        'SUM("gi"."amount_due_cents" - "gi"."amount_paid_cents")',
      );
      expect(params).toEqual(
        expect.arrayContaining(['open', 'uncollectible', 'o1', 'o2']),
      );
      expect(result.get('o1')).toEqual({ amountCents: 39800, invoices: 2 });
      expect(result.get('o2')).toBeUndefined();
    });

    it('lista vazia não consulta o banco', async () => {
      const result = await repository.outstandingByOwner([]);
      expect(result.size).toBe(0);
      expect(consultas).toHaveLength(0);
    });
  });

  describe('findInvoices', () => {
    it('filtra por status, conta e período, pagina e ordena pela criação da fatura', async () => {
      await repository.findInvoices({
        status: 'open',
        ownerId: 'o1',
        from,
        to,
        limit: 20,
        offset: 40,
      });

      const { sql, params } = ultima('FROM "gateway_invoices"');
      expect(sql).toMatch(
        /LEFT JOIN "users" "o" ON "o"\."id"="gi"\."owner_id"/,
      );
      expect(sql).toContain('"gi"."status" = $');
      expect(sql).toContain('"gi"."owner_id" = $');
      expect(sql).toContain('"gi"."invoice_created_at" >= $');
      expect(sql).toContain('"gi"."invoice_created_at" < $');
      expect(params).toEqual(expect.arrayContaining(['open', 'o1', from, to]));
      const pagina = ultima('ORDER BY');
      expect(pagina.sql).toMatch(/ORDER BY .*invoice_created_at.* DESC/);
      expect(pagina.sql).toMatch(/LIMIT 20/);
      expect(pagina.sql).toMatch(/OFFSET 40/);
      expect(sql).not.toContain('"o"."password"');
    });

    it('sem filtros não restringe', async () => {
      await repository.findInvoices({ limit: 25, offset: 0 });

      const { sql } = ultima('FROM "gateway_invoices"');
      expect(sql).not.toContain('"gi"."status" = $');
      expect(sql).not.toContain('"gi"."owner_id" = $');
    });
  });

  describe('findRevenueSubscriptions', () => {
    it('ativas e inadimplentes com assinatura na Stripe, só donos de conta', async () => {
      await repository.findRevenueSubscriptions();

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toContain('"s"."status" IN (');
      expect(sql).toContain('"s"."gateway_subscription_id" IS NOT NULL');
      expect(sql).toContain('"o"."owner_id" = "o"."id"');
      expect(params).toEqual(expect.arrayContaining(['active', 'past_due']));
      expect(params).not.toContain('internal');
    });
  });

  describe('findDelinquentSubscriptions', () => {
    it('inadimplentes e suspensas, só donos de conta, mais antigas primeiro', async () => {
      await repository.findDelinquentSubscriptions();

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toContain('"s"."status" IN (');
      expect(sql).toContain('"o"."owner_id" = "o"."id"');
      expect(params).toEqual(expect.arrayContaining(['past_due', 'suspended']));
      expect(sql).toMatch(/ORDER BY .*past_due_since.* ASC/);
    });
  });

  describe('findPlansWithAccountCounts', () => {
    it('lista os planos com a contagem de contas vivas (sem canceladas e acesso interno)', async () => {
      respostas = [
        {
          trecho: 'FROM "subscriptions"',
          records: [{ planId: 'p1', count: '3' }],
        },
      ];

      const result = await repository.findPlansWithAccountCounts();

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toContain('"s"."status" NOT IN (');
      expect(params).toEqual(expect.arrayContaining(['canceled', 'internal']));
      expect(ultima('FROM "subscription_plans"').sql).toMatch(
        /ORDER BY .*sort_order.* ASC/,
      );
      expect(result.counts.get('p1')).toBe(3);
    });
  });
});
