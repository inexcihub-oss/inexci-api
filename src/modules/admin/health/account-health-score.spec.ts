import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { AccountHealthInput } from 'src/database/repositories/account-health.repository';
import { ACCOUNT_HEALTH_CONFIG } from './account-health.config';
import { bandOf, scoreAccount } from './account-health-score';

const now = new Date('2026-10-28T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(now.getTime() + n * DAY);

function input(over: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    ownerId: 'o1',
    ownerCreatedAt: daysAgo(120),
    deactivated: false,
    status: SubscriptionStatus.ACTIVE,
    trialEndsAt: null,
    hasGatewaySubscription: true,
    pastDueSince: null,
    lastSeenAt: daysAgo(1),
    usageCurrent: 10,
    usagePrevious: 10,
    quotaUsed: 5,
    quotaLimit: 50,
    errors: 0,
    deliveryFailures: 0,
    ...over,
  };
}

const factor = (over: Partial<AccountHealthInput>, key: string) =>
  scoreAccount(input(over), now)?.factors.find((f) => f.key === key);

describe('scoreAccount', () => {
  it('conta ativa e em uso fica com 100, saudável e sem fatores', () => {
    expect(scoreAccount(input(), now)).toEqual({
      score: 100,
      band: 'healthy',
      factors: [],
    });
  });

  describe('faixas', () => {
    it.each([
      [100, 'healthy'],
      [70, 'healthy'],
      [69, 'attention'],
      [40, 'attention'],
      [39, 'risk'],
      [0, 'risk'],
    ] as const)('%i → %s', (score, band) => {
      expect(bandOf(score)).toBe(band);
    });
  });

  describe('último acesso', () => {
    it.each([
      [6, undefined],
      [7, 15],
      [14, 25],
      [30, 35],
    ])('%i dias sem acesso tira %s pontos', (days, points) => {
      expect(factor({ lastSeenAt: daysAgo(days) }, 'last_seen')?.points).toBe(
        points,
      );
    });

    it('explica em dias', () => {
      expect(factor({ lastSeenAt: daysAgo(18) }, 'last_seen')?.message).toBe(
        'Ninguém da clínica acessa há 18 dias',
      );
    });

    it('nunca acessou e a conta é antiga: pior faixa, dizendo desde o cadastro', () => {
      const f = factor(
        { lastSeenAt: null, ownerCreatedAt: daysAgo(12) },
        'last_seen',
      );
      expect(f).toEqual({
        key: 'last_seen',
        points: 35,
        message: 'Ninguém da clínica acessou desde o cadastro, há 12 dias',
      });
    });
  });

  describe('variação de uso', () => {
    it('queda de 60% tira 12 pontos e explica os números', () => {
      expect(
        factor({ usagePrevious: 10, usageCurrent: 4 }, 'usage_drop'),
      ).toEqual({
        key: 'usage_drop',
        points: 12,
        message:
          'Uso caiu 60% em relação à semana anterior (10 → 4 SCs e consultas)',
      });
    });

    it('queda total tira 20', () => {
      expect(
        factor({ usagePrevious: 8, usageCurrent: 0 }, 'usage_drop')?.points,
      ).toBe(20);
    });

    it('queda pequena ou aumento não conta', () => {
      expect(
        factor({ usagePrevious: 10, usageCurrent: 9 }, 'usage_drop'),
      ).toBeUndefined();
      expect(
        factor({ usagePrevious: 4, usageCurrent: 12 }, 'usage_drop'),
      ).toBeUndefined();
    });

    it('semana anterior com pouco uso não serve de base', () => {
      expect(
        factor({ usagePrevious: 2, usageCurrent: 0 }, 'usage_drop'),
      ).toBeUndefined();
    });
  });

  describe('trial', () => {
    const trial = {
      status: SubscriptionStatus.TRIALING,
      hasGatewaySubscription: false,
    };

    it('termina em 3 dias sem cartão', () => {
      expect(
        factor({ ...trial, trialEndsAt: daysAhead(3) }, 'trial_ending'),
      ).toEqual({
        key: 'trial_ending',
        points: 15,
        message: 'Trial termina em 3 dias e não há cartão cadastrado',
      });
    });

    it('com cartão (assinatura na Stripe) não conta', () => {
      expect(
        factor(
          { ...trial, hasGatewaySubscription: true, trialEndsAt: daysAhead(3) },
          'trial_ending',
        ),
      ).toBeUndefined();
    });

    it('termina daqui a mais de 7 dias não conta', () => {
      expect(
        factor({ ...trial, trialEndsAt: daysAhead(10) }, 'trial_ending'),
      ).toBeUndefined();
    });

    it('trial vencido sem assinatura pesa mais', () => {
      expect(
        factor({ ...trial, trialEndsAt: daysAgo(5) }, 'trial_ending'),
      ).toEqual({
        key: 'trial_ending',
        points: 25,
        message: 'Trial venceu há 5 dias sem assinatura',
      });
    });
  });

  describe('cota', () => {
    it('acima de 80% tira 8', () => {
      expect(factor({ quotaUsed: 42, quotaLimit: 50 }, 'quota')).toEqual({
        key: 'quota',
        points: 8,
        message: 'Usou 84% da cota de SCs do período (42 de 50)',
      });
    });

    it('esgotada tira 12', () => {
      expect(factor({ quotaUsed: 50, quotaLimit: 50 }, 'quota')?.points).toBe(
        12,
      );
    });

    it('ilimitada, sem período ou abaixo do limite não conta', () => {
      expect(
        factor({ quotaUsed: 500, quotaLimit: -1 }, 'quota'),
      ).toBeUndefined();
      expect(
        factor({ quotaUsed: null, quotaLimit: null }, 'quota'),
      ).toBeUndefined();
      expect(
        factor({ quotaUsed: 39, quotaLimit: 50 }, 'quota'),
      ).toBeUndefined();
    });
  });

  describe('erros da plataforma', () => {
    it.each([
      [0, undefined],
      [1, 3],
      [5, 8],
      [20, 15],
    ])('%i erros tiram %s pontos', (errors, points) => {
      expect(factor({ errors }, 'errors')?.points).toBe(points);
    });

    it('explica a janela', () => {
      expect(factor({ errors: 6 }, 'errors')?.message).toBe(
        '6 erros da plataforma nos últimos 3 dias',
      );
    });
  });

  describe('falhas de envio', () => {
    it.each([
      [2, undefined],
      [3, 5],
      [10, 10],
    ])('%i falhas tiram %s pontos', (deliveryFailures, points) => {
      expect(factor({ deliveryFailures }, 'delivery_failures')?.points).toBe(
        points,
      );
    });

    it('singular e plural', () => {
      expect(
        factor({ deliveryFailures: 4 }, 'delivery_failures')?.message,
      ).toBe('4 envios de e-mail ou WhatsApp falharam nas últimas 72 h');
    });
  });

  describe('inadimplência', () => {
    it('em atraso há 4 dias tira 25', () => {
      expect(
        factor(
          { status: SubscriptionStatus.PAST_DUE, pastDueSince: daysAgo(4) },
          'delinquency',
        ),
      ).toEqual({
        key: 'delinquency',
        points: 25,
        message: 'Pagamento em atraso há 4 dias',
      });
    });

    it('suspensa tira 40', () => {
      expect(
        factor({ status: SubscriptionStatus.SUSPENDED }, 'delinquency')?.points,
      ).toBe(40);
    });
  });

  describe('contas fora da avaliação e casos de borda', () => {
    it('cancelada e desativada ficam sem nota', () => {
      expect(
        scoreAccount(input({ status: SubscriptionStatus.CANCELED }), now),
      ).toBeNull();
      expect(scoreAccount(input({ deactivated: true }), now)).toBeNull();
    });

    it('acesso interno tem nota, mas sem fator de trial nem de inadimplência', () => {
      const result = scoreAccount(
        input({
          status: SubscriptionStatus.INTERNAL,
          hasGatewaySubscription: false,
          trialEndsAt: daysAgo(3),
          errors: 6,
        }),
        now,
      );
      expect(result?.factors.map((f) => f.key)).toEqual(['errors']);
    });

    it('conta nova sem histórico não cai em risco só por falta de dados', () => {
      const result = scoreAccount(
        input({
          ownerCreatedAt: daysAgo(2),
          status: SubscriptionStatus.TRIALING,
          hasGatewaySubscription: false,
          trialEndsAt: daysAhead(13),
          lastSeenAt: null,
          usageCurrent: 0,
          usagePrevious: 0,
          quotaUsed: null,
          quotaLimit: null,
        }),
        now,
      );
      expect(result).toEqual({ score: 100, band: 'healthy', factors: [] });
    });

    it('soma os fatores, ordena do mais pesado e nunca passa de 0', () => {
      const result = scoreAccount(
        input({
          status: SubscriptionStatus.SUSPENDED,
          lastSeenAt: daysAgo(40),
          usagePrevious: 10,
          usageCurrent: 0,
          errors: 30,
          deliveryFailures: 12,
          quotaUsed: 50,
          quotaLimit: 50,
        }),
        now,
      );
      expect(result?.score).toBe(0);
      expect(result?.band).toBe('risk');
      expect(result?.factors.map((f) => f.points)).toEqual([
        40, 35, 20, 15, 12, 10,
      ]);
    });

    it('os pesos e as faixas vêm de um único arquivo de configuração', () => {
      const result = scoreAccount(input({ errors: 6 }), now, {
        ...ACCOUNT_HEALTH_CONFIG,
        bands: { healthy: 95, attention: 90 },
        errors: { windowDays: 3, steps: [{ threshold: 1, points: 50 }] },
      });
      expect(result).toMatchObject({ score: 50, band: 'risk' });
    });
  });
});
