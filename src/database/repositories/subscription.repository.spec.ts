import { DataSource, EntityManager } from 'typeorm';
import { ENTITIES } from '../entities';
import { SubscriptionQuotaPeriodRepository } from './subscription-quota-period.repository';
import { SubscriptionRepository } from './subscription.repository';

describe('consultas do painel sobre assinatura (query builder real)', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let dataSource: DataSource;
  let manager: EntityManager;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const runner = {
      connection: dataSource,
      manager: dataSource.manager,
      isTransactionActive: true,
      isReleased: false,
      data: {},
      broadcaster: { broadcast: jest.fn().mockResolvedValue(undefined) },
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        if (sql.startsWith('UPDATE')) {
          return Promise.resolve({ records: [], affected: 1 });
        }
        return Promise.resolve({ records: [] });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    manager = dataSource.manager;
  });

  beforeEach(() => {
    consultas.length = 0;
  });

  describe('SubscriptionRepository.lockByOwnerId', () => {
    it('trava a linha com FOR UPDATE sem join no plano', async () => {
      const repository = new SubscriptionRepository(
        dataSource.getRepository('Subscription') as never,
      );

      const result = await repository.lockByOwnerId('owner-1', manager);

      expect(result).toBeNull();
      const select = consultas.find((c) => c.sql.includes('"subscriptions"'));
      expect(select).toBeDefined();
      expect(select!.sql).toContain('FOR UPDATE');
      expect(select!.sql).not.toContain('subscription_plans');
      expect(select!.sql).toContain('owner_id');
      expect(select!.params).toContain('owner-1');
    });
  });

  describe('SubscriptionRepository.findWithGatewaySubscription', () => {
    it('lista as assinaturas com id na Stripe, fora o acesso interno', async () => {
      const repository = new SubscriptionRepository(
        dataSource.getRepository('Subscription') as never,
      );

      await repository.findWithGatewaySubscription();

      const select = consultas.find((c) => c.sql.includes('"subscriptions"'));
      expect(select!.sql).toContain(
        'NOT("Subscription"."gateway_subscription_id" IS NULL)',
      );
      expect(select!.sql).toContain('"Subscription"."status" != $1');
      expect(select!.params).toContain('internal');
    });
  });

  describe('SubscriptionRepository.updateUnlessInternal', () => {
    it('grava só se a linha não estiver em acesso interno no momento do UPDATE', async () => {
      const repository = new SubscriptionRepository(
        dataSource.getRepository('Subscription') as never,
      );

      const applied = await repository.updateUnlessInternal('sub-1', {
        status: 'canceled' as never,
      });

      expect(applied).toBe(true);
      const update = consultas.find((c) => c.sql.startsWith('UPDATE'));
      expect(update).toBeDefined();
      expect(update!.sql).toContain('"subscriptions"');
      expect(update!.sql).toMatch(/"?status"? <> /);
      expect(update!.params).toEqual(
        expect.arrayContaining(['sub-1', 'internal', 'canceled']),
      );
    });
  });

  describe('SubscriptionQuotaPeriodRepository.closeCurrentPeriods', () => {
    it('encerra no instante informado os períodos vigentes da assinatura', async () => {
      const repository = new SubscriptionQuotaPeriodRepository(
        dataSource.getRepository('SubscriptionQuotaPeriod') as never,
      );
      const at = new Date('2026-10-24T12:00:00Z');

      await repository.closeCurrentPeriods('sub-1', at, manager);

      const update = consultas.find((c) => c.sql.startsWith('UPDATE'));
      expect(update).toBeDefined();
      expect(update!.sql).toContain('"subscription_quota_periods"');
      expect(update!.sql).toContain('"period_end"');
      expect(update!.sql).toContain('"subscription_id"');
      expect(update!.params).toEqual(expect.arrayContaining(['sub-1', at]));
    });
  });
});
