import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { AdminAccountsRepository } from './admin-accounts.repository';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { computeMonthlyAmountCents } from 'src/modules/admin/accounts/admin-account-situation';

type LinhaMrr = Record<string, unknown>;

function avaliarSql(
  expressao: string,
  params: unknown[],
  linha: LinhaMrr,
): number {
  let js = expressao;
  for (let guarda = 0; /CASE/.test(js) && guarda < 50; guarda++) {
    js = js.replace(/CASE((?:(?!CASE|END).)*)END/s, (_m, corpo: string) => {
      const [semElse, senao = '0'] = corpo.split(/\bELSE\b/);
      const ramos = semElse
        .split(/\bWHEN\b/)
        .slice(1)
        .map((r) => r.split(/\bTHEN\b/));
      return ramos.reduceRight(
        (acc, [cond, valor]) => `((${cond}) ? (${valor}) : (${acc}))`,
        `(${senao})`,
      );
    });
  }
  js = js
    .replace(/("[a-z]+"\."[a-z_]+") IN \(([^)]*)\)/g, '[$2].includes($1)')
    .replace(/ IS NOT NULL/g, ' != null')
    .replace(/ IS NULL/g, ' == null')
    .replace(/\bAND\b/g, '&&')
    .replace(/\bOR\b/g, '||')
    .replace(/\bNOT\b/g, '!')
    .replace(/ = /g, ' === ')
    .replace(/\bLEAST\(/g, 'Math.min(')
    .replace(/\bGREATEST\(/g, 'Math.max(')
    .replace(/\bROUND\(/g, 'Math.round(')
    .replace(/\bFLOOR\(/g, 'Math.floor(')
    .replace(/\bCOALESCE\(/g, 'coalesce(')
    .replace(
      /"([a-z]+)"\."([a-z_]+)"/g,
      (_m, a: string, c: string) => `linha["${a}.${c}"]`,
    )
    .replace(/\$(\d+)/g, (_m, n: string) => `params[${Number(n) - 1}]`);
  const coalesce = (...v: unknown[]) =>
    v.find((x) => x !== null && x !== undefined);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('linha', 'params', 'coalesce', `return (${js});`) as (
    l: LinhaMrr,
    p: unknown[],
    c: typeof coalesce,
  ) => unknown;
  return Number(fn(linha, params, coalesce));
}

describe('AdminAccountsRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let gruposDeSituacao: unknown[] = [];
  let repository: AdminAccountsRepository;
  const now = new Date('2026-10-23T15:00:00Z');
  const month = {
    from: new Date('2026-10-01T03:00:00Z'),
    to: new Date('2026-11-01T03:00:00Z'),
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
        if (sql.includes('GROUP BY "s"."status"')) {
          return Promise.resolve({ records: gruposDeSituacao });
        }
        return Promise.resolve({
          records: sql.includes('COUNT(DISTINCT') ? [{ cnt: '0' }] : [],
        });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repository = new AdminAccountsRepository(
      dataSource.getRepository('Subscription') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    gruposDeSituacao = [];
  });

  const ultima = (trecho: string): { sql: string; params: unknown[] } => {
    const achada = [...consultas].reverse().find((c) => c.sql.includes(trecho));
    if (!achada) throw new Error(`nenhuma consulta com ${trecho}`);
    return achada;
  };

  const pagina = {
    sortBy: 'createdAt' as const,
    sortDir: 'DESC' as const,
    limit: 25,
    offset: 0,
    now,
  };

  describe('findPage', () => {
    it('lista só donos de conta com assinatura (admin puro fica de fora), com limit e offset', async () => {
      await repository.findPage({ ...pagina, limit: 20, offset: 40 });

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toMatch(
        /INNER JOIN "users" "o" ON "o"\."id"="s"\."owner_id"/,
      );
      expect(sql).toContain('"o"."owner_id" = "o"."id"');
      expect(sql).toMatch(/LIMIT 20/);
      expect(sql).toMatch(/OFFSET 40/);
      expect(sql).toMatch(/ORDER BY/);
    });

    it('busca por nome ou e-mail com ILIKE e escapa curingas', async () => {
      await repository.findPage({ ...pagina, search: '50%_x' });

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toContain('ILIKE');
      expect(params).toContain('%50\\%\\_x%');
    });

    it.each([
      ['trial', 'trial_ends_at" IS NULL OR'],
      ['trial_expired', 'trial_ends_at" <='],
      ['active', 'cancel_at_period_end" = false'],
      ['cancel_scheduled', 'cancel_at_period_end" = true'],
      ['past_due', 'status" ='],
    ] as const)('filtra pela situação %s', async (situation, trecho) => {
      await repository.findPage({ ...pagina, situation });

      expect(ultima('FROM "subscriptions"').sql).toContain(trecho);
    });

    it('Desativada filtra pela marca no dono; as outras situações excluem desativadas', async () => {
      await repository.findPage({ ...pagina, situation: 'deactivated' });
      expect(ultima('FROM "subscriptions"').sql).toContain(
        '"o"."account_deactivated_at" IS NOT NULL',
      );

      await repository.findPage({ ...pagina, situation: 'active' });
      expect(ultima('FROM "subscriptions"').sql).toContain(
        '"o"."account_deactivated_at" IS NULL',
      );
    });

    it('Trial inclui ACTIVE com trial vigente (trial com cartão)', async () => {
      await repository.findPage({ ...pagina, situation: 'trial' });

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toMatch(
        /"s"\."status" = \S+ AND "s"\."trial_ends_at" IS NOT NULL AND "s"\."trial_ends_at" > /,
      );
      expect(params).toEqual(expect.arrayContaining(['trialing', 'active']));
    });

    it.each(['active', 'cancel_scheduled'] as const)(
      '%s exclui quem ainda está em trial',
      async (situation) => {
        await repository.findPage({ ...pagina, situation });

        expect(ultima('FROM "subscriptions"').sql).toContain(
          '"trial_ends_at" IS NULL OR "s"."trial_ends_at" <=',
        );
      },
    );

    it('Trial acabando em N dias também considera ACTIVE em trial', async () => {
      await repository.findPage({ ...pagina, trialEndingInDays: 3 });

      const { params } = ultima('FROM "subscriptions"');
      expect(params).toEqual(expect.arrayContaining(['trialing', 'active']));
    });

    it('filtra por plano', async () => {
      await repository.findPage({ ...pagina, planId: 'plan-1' });

      expect(ultima('FROM "subscriptions"').params).toContain('plan-1');
    });

    it('trial acabando em N dias limita a janela', async () => {
      await repository.findPage({ ...pagina, trialEndingInDays: 3 });

      const { params } = ultima('FROM "subscriptions"');
      expect(params).toContainEqual(new Date('2026-10-26T15:00:00Z'));
    });

    it('sem acesso há N dias olha o último acesso do tenant', async () => {
      await repository.findPage({ ...pagina, inactiveDays: 7 });

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toContain('MAX(lu.last_seen_at)');
      expect(sql).toContain('lu.owner_id = "s"."owner_id"');
      expect(sql).toContain('lu.deleted_at IS NULL');
    });

    it('filtra pela faixa de saúde do último cálculo', async () => {
      await repository.findPage({ ...pagina, health: 'risk' });

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toContain('FROM account_health_daily h');
      expect(sql).toContain('h.owner_id = "s"."owner_id"');
      expect(sql).toContain('SELECT MAX(hd.day) FROM account_health_daily hd');
      expect(params).toContain('risk');
    });

    it('ordenar por saúde usa a nota do último cálculo', async () => {
      await repository.findPage({
        ...pagina,
        sortBy: 'health',
        sortDir: 'ASC',
      });

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toContain('SELECT h.score FROM account_health_daily h');
      expect(sql).toMatch(/ORDER BY sort_value ASC NULLS LAST/);
    });

    it.each([
      'createdAt',
      'trialEndsAt',
      'lastSeenAt',
      'mrr',
      'health',
    ] as const)('ordena por %s sem estourar', async (sortBy) => {
      await repository.findPage({ ...pagina, sortBy, sortDir: 'ASC' });

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toMatch(/ORDER BY sort_value ASC NULLS LAST/);
    });

    it('ordenar por mrr usa o preço normalizado por mês, com floor no anual', async () => {
      await repository.findPage({ ...pagina, sortBy: 'mrr' });

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toContain("'active','past_due'");
      expect(sql).toMatch(/FLOOR\(.*\/ 12\.0\)/s);
    });

    it('ordenar por mrr abate o desconto local (percentual, fixo, repetindo vigente)', async () => {
      await repository.findPage({ ...pagina, sortBy: 'mrr' });

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toContain(
        'ROUND("p"."price_cents" * "s"."discount_percent_off" / 100)',
      );
      expect(sql).toContain('COALESCE("s"."discount_amount_off_cents", 0)');
      expect(sql).toContain('"s"."discount_duration" = \'forever\'');
      expect(sql).toContain('"s"."discount_duration" = \'repeating\'');
      expect(sql).toContain('"s"."discount_ends_at" IS NULL');
      expect(sql).toContain('"s"."discount_ends_at" >');
      expect(sql).toContain('LEAST("p"."price_cents", GREATEST(0,');
    });

    describe('valor de ordenação == mensalidade exibida (computeMonthlyAmountCents)', () => {
      const semDesconto = {
        discountPercentOff: null,
        discountAmountOffCents: null,
        discountDuration: null,
        discountEndsAt: null,
      };
      const casos: Array<
        [
          string,
          Record<string, unknown>,
          { priceCents: number; billingPeriod: 'MONTHLY' | 'YEARLY' },
        ]
      > = [
        [
          'mensal 20% para sempre',
          { discountPercentOff: 20, discountDuration: 'forever' },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'mensal 33% arredonda',
          { discountPercentOff: 33, discountDuration: 'forever' },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'fixo de R$ 50 repetindo vigente',
          {
            discountAmountOffCents: 5000,
            discountDuration: 'repeating',
            discountEndsAt: new Date('2027-01-01T00:00:00Z'),
          },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'repetindo vencido não abate',
          {
            discountPercentOff: 50,
            discountDuration: 'repeating',
            discountEndsAt: new Date('2026-10-01T00:00:00Z'),
          },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'repetindo sem fim gravado abate',
          { discountPercentOff: 50, discountDuration: 'repeating' },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'uso único não abate',
          { discountPercentOff: 50, discountDuration: 'once' },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'fixo maior que o preço zera',
          { discountAmountOffCents: 99999, discountDuration: 'forever' },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'anual com 10%',
          { discountPercentOff: 10, discountDuration: 'forever' },
          { priceCents: 299000, billingPeriod: 'YEARLY' },
        ],
        [
          'anual 12,5% com floor',
          { discountPercentOff: 12.5, discountDuration: 'forever' },
          { priceCents: 100001, billingPeriod: 'YEARLY' },
        ],
        [
          'anual sem desconto',
          {},
          { priceCents: 100001, billingPeriod: 'YEARLY' },
        ],
        [
          'inadimplente com desconto',
          {
            status: SubscriptionStatus.PAST_DUE,
            discountPercentOff: 20,
            discountDuration: 'forever',
          },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'trial com cartão e desconto vale zero',
          {
            trialEndsAt: new Date('2026-10-30T15:00:00Z'),
            discountPercentOff: 20,
            discountDuration: 'forever',
          },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'suspensa vale zero',
          {
            status: SubscriptionStatus.SUSPENDED,
            discountPercentOff: 20,
            discountDuration: 'forever',
          },
          { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ],
        [
          'plano grátis',
          { discountAmountOffCents: 500, discountDuration: 'forever' },
          { priceCents: 0, billingPeriod: 'MONTHLY' },
        ],
      ];

      it.each(casos)('%s', async (_nome, overrides, plano) => {
        await repository.findPage({ ...pagina, sortBy: 'mrr' });
        const { sql, params } = ultima('FROM "subscriptions"');
        const expressao = /, (\(CASE .*?END\)) AS "sort_value"/s.exec(sql)?.[1];
        expect(expressao).toBeDefined();

        const sub = {
          status: SubscriptionStatus.ACTIVE,
          trialEndsAt: null,
          ...semDesconto,
          ...overrides,
        } as Record<string, unknown>;
        const linha: LinhaMrr = {
          's.status': sub.status,
          's.trial_ends_at': sub.trialEndsAt,
          's.discount_percent_off': sub.discountPercentOff,
          's.discount_amount_off_cents': sub.discountAmountOffCents,
          's.discount_duration': sub.discountDuration,
          's.discount_ends_at': sub.discountEndsAt,
          'p.price_cents': plano.priceCents,
          'p.billing_period': plano.billingPeriod,
        };

        expect(avaliarSql(expressao!, params, linha)).toBe(
          computeMonthlyAmountCents(sub as never, plano, now),
        );
      });
    });

    it('ordenar por mrr zera quem está em trial', async () => {
      await repository.findPage({ ...pagina, sortBy: 'mrr' });

      const { sql, params } = ultima('FROM "subscriptions"');
      expect(sql).toContain('"s"."trial_ends_at" >');
      expect(params).toContainEqual(now);
    });
  });

  describe('countBySituation', () => {
    it('agrupa em uma única consulta, respeitando busca e plano', async () => {
      await repository.countBySituation({
        search: 'ana',
        planId: 'plan-1',
        now,
      });

      const grupos = consultas.filter((c) => c.sql.includes('GROUP BY'));
      expect(grupos).toHaveLength(1);
      expect(grupos[0].sql).toContain('"s"."cancel_at_period_end"');
      expect(grupos[0].params).toContain('plan-1');
    });

    it('classifica como no filtro: ACTIVE em trial conta como Trial', async () => {
      gruposDeSituacao = [
        {
          status: 'active',
          cancel: false,
          expired: false,
          intrial: true,
          count: '2',
        },
        {
          status: 'active',
          cancel: true,
          expired: false,
          intrial: true,
          count: '1',
        },
        {
          status: 'active',
          cancel: false,
          expired: true,
          intrial: false,
          count: '5',
        },
        {
          status: 'active',
          cancel: false,
          expired: false,
          intrial: false,
          count: '3',
        },
        {
          status: 'active',
          cancel: true,
          expired: true,
          intrial: false,
          count: '4',
        },
        {
          status: 'trialing',
          cancel: false,
          expired: true,
          intrial: false,
          count: '6',
        },
        {
          status: 'trialing',
          cancel: false,
          expired: false,
          intrial: false,
          count: '7',
        },
      ];

      const result = await repository.countBySituation({ now });

      const porSituacao = Object.fromEntries(
        result.map((r) => [r.situation, r.count]),
      );
      expect(porSituacao).toEqual({
        trial: 10,
        active: 8,
        cancel_scheduled: 4,
        trial_expired: 6,
      });
    });

    it('conta desativada pelo painel vai para Desativada, qualquer que seja a assinatura', async () => {
      gruposDeSituacao = [
        {
          status: 'active',
          cancel: false,
          expired: false,
          intrial: false,
          deactivated: true,
          count: '2',
        },
        {
          status: 'internal',
          cancel: false,
          expired: false,
          intrial: false,
          deactivated: true,
          count: '1',
        },
        {
          status: 'active',
          cancel: false,
          expired: false,
          intrial: false,
          deactivated: false,
          count: '5',
        },
      ];

      const result = await repository.countBySituation({ now });

      const porSituacao = Object.fromEntries(
        result.map((r) => [r.situation, r.count]),
      );
      expect(porSituacao).toEqual({ deactivated: 3, active: 5 });
      expect(ultima('GROUP BY').sql).toContain(
        '"o"."account_deactivated_at" IS NOT NULL',
      );
    });
  });

  describe('loadMetrics', () => {
    it('não consulta nada sem contas', async () => {
      const metrics = await repository.loadMetrics([], [], month, now);

      expect(consultas).toHaveLength(0);
      expect(metrics.team.size).toBe(0);
    });

    it('faz uma consulta agrupada por métrica com IN dos ids', async () => {
      await repository.loadMetrics(['o-1', 'o-2'], ['s-1', 's-2'], month, now);

      const agrupadas = consultas.filter((c) => c.sql.includes('GROUP BY'));
      expect(agrupadas).toHaveLength(4);
      for (const consulta of consultas) {
        expect(consulta.sql).toMatch(/IN \(\$\d+, \$\d+\)/);
      }
      expect(consultas).toHaveLength(5);
    });

    it('médicos têm perfil e colaboradores não incluem o dono', async () => {
      await repository.loadMetrics(['o-1'], ['s-1'], month, now);

      const { sql } = ultima('FROM "users"');
      expect(sql).toContain('FILTER (WHERE "dp"."id" IS NOT NULL)');
      expect(sql).toContain('"dp"."id" IS NULL AND "u"."id" <> "u"."owner_id"');
      expect(sql).toContain('GROUP BY "u"."owner_id"');
    });

    it('custo de IA soma centavos de dólar do mês por dono', async () => {
      await repository.loadMetrics(['o-1'], ['s-1'], month, now);

      const { sql, params } = ultima('FROM "ai_token_usage_logs"');
      expect(sql).toContain('SUM("ai"."cost_estimate_cents")');
      expect(sql).toContain('GROUP BY "ai"."owner_id"');
      expect(params).toEqual(expect.arrayContaining([month.from, month.to]));
    });

    it('cota usa o período vigente das assinaturas da página', async () => {
      await repository.loadMetrics(['o-1'], ['s-1'], month, now);

      const { sql, params } = ultima('FROM "subscription_quota_periods"');
      expect(sql).toContain('"q"."period_start" <=');
      expect(params).toContain('s-1');
    });
  });

  describe('detalhe', () => {
    const range = month;

    it('SCs por status, consultas e pacientes filtram por dono e período', async () => {
      await repository.surgeryRequestsByStatus('o-1', range);
      await repository.appointmentsByStatus('o-1', range);
      await repository.patientCounts('o-1', range);

      for (const c of consultas) {
        expect(c.params).toContain('o-1');
      }
      expect(ultima('FROM "patients"').sql).toContain('FILTER');
    });

    it('mensagens da IA passam pela conversa do dono', async () => {
      await repository.aiMessagesCount('o-1', range);

      const { sql, params } = ultima('whatsapp_conversation_messages');
      expect(sql).toContain('"c"."owner_id" = $1');
      expect(params).toContain('o-1');
    });

    it('fichas finalizadas usam finalized_at', async () => {
      await repository.finalizedRecordsCount('o-1', range);

      expect(ultima('FROM "clinical_records"').sql).toContain('finalized_at');
    });

    it('atividade semanal agrupa por semana no fuso de São Paulo', async () => {
      await repository.weeklySurgeryRequests('o-1', range.from);
      await repository.weeklyAppointments('o-1', range.from);

      for (const c of consultas) {
        expect(c.sql).toContain("date_trunc('week'");
        expect(c.sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
      }
    });

    it('equipe seleciona só colunas seguras (telefone só para mascarar no service)', async () => {
      await repository.findTeam('o-1');

      const { sql } = ultima('FROM "users"');
      expect(sql).not.toContain('"cpf"');
      expect(sql).not.toContain('"mfa_secret"');
      expect(sql).not.toContain('"mfa_pending_secret"');
      expect(sql).not.toContain('"mfa_recovery_codes"');
      expect(sql).not.toContain('"password"');
      expect(sql).toContain('"u"."phone"');
      expect(sql).toContain('"u"."mfa_enabled_at"');
      expect(sql).toContain('"u"."onboarding_state"');
      expect(sql).toContain('"u"."owner_id" = $1');
    });

    it('conta por dono usa a assinatura mais recente', async () => {
      await repository.findByOwnerId('o-1');

      const { sql } = ultima('FROM "subscriptions"');
      expect(sql).toContain('"s"."owner_id" = $1');
    });
  });

  describe('findPlatformAdminName', () => {
    it('lê só id e nome do administrador da plataforma que concedeu', async () => {
      const name = await repository.findPlatformAdminName('admin-1');

      expect(name).toBeNull();
      const { sql, params } = ultima('FROM "platform_admins"');
      expect(sql).toContain('"pa"."name"');
      expect(sql).not.toContain('"pa"."email"');
      expect(sql).not.toContain('password_hash');
      expect(params).toContain('admin-1');
    });
  });
});
