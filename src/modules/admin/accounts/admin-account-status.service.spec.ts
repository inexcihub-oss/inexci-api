import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';
import { AdminAccountStatusService } from './admin-account-status.service';
import { MENSAGEM_DESATIVAR_COM_ASSINATURA } from '../subscriptions/subscription-admin-rules';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const OWNER = 'owner-1';
const ACTOR = 'admin-1';
const REASON = 'Cliente encerrou o contrato';

function gatewaySub(
  overrides: Partial<GatewaySubscription> = {},
): GatewaySubscription {
  return {
    id: 'gw-sub-1',
    customerId: 'cus-1',
    status: 'active',
    providerStatus: 'active',
    cycle: 'MONTHLY',
    amountCents: 19900,
    nextDueDate: null,
    priceId: 'price_1',
    currentPeriodStart: NOW,
    currentPeriodEnd: NOW,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  };
}

function build(
  options: {
    owner?: { accountDeactivatedAt: Date | null } | null;
    sub?: Record<string, unknown> | null;
    remote?: GatewaySubscription | null;
    gatewayFails?: boolean;
    revokeFailsFor?: string;
  } = {},
) {
  const state = {
    owner:
      options.owner === undefined
        ? {
            id: OWNER,
            ownerId: OWNER,
            accountDeactivatedAt: null as Date | null,
            accountDeactivatedById: null as string | null,
          }
        : options.owner
          ? {
              id: OWNER,
              ownerId: OWNER,
              accountDeactivatedById: null as string | null,
              ...options.owner,
            }
          : null,
  };
  const writes: Array<{ at: Date | null; byId: string | null }> = [];

  const dataSource = {
    transaction: jest.fn(<T>(fn: (m: object) => Promise<T>) => fn({})),
  };
  const userRepository = {
    lockAccountOwner: jest.fn(() => Promise.resolve(state.owner)),
    setAccountDeactivation: jest.fn(
      (_id: string, values: { at: Date | null; byId: string | null }) => {
        writes.push(values);
        return Promise.resolve();
      },
    ),
    findAccountMembers: jest.fn(() =>
      Promise.resolve([
        { id: OWNER, phone: '11999990000' },
        { id: 'user-2', phone: '11999990001' },
      ]),
    ),
  };
  const subscriptionRepo = {
    lockByOwnerId: jest.fn(() =>
      Promise.resolve(
        options.sub === null
          ? null
          : {
              id: 'sub-1',
              ownerId: OWNER,
              status: SubscriptionStatus.TRIALING,
              gatewayProvider: 'stripe',
              gatewayCustomerId: null,
              gatewaySubscriptionId: null,
              ...(options.sub ?? {}),
            },
      ),
    ),
  };
  const audit = {
    begin: jest.fn(() => Promise.resolve({ id: 'audit-1' })),
    succeed: jest.fn(() => Promise.resolve()),
    fail: jest.fn(() => Promise.resolve()),
  };
  const sessionRevocation = {
    revokeAllSessions: jest.fn((userId: string) =>
      userId === options.revokeFailsFor
        ? Promise.reject(new Error('redis fora'))
        : Promise.resolve(),
    ),
  };
  const gateway = {
    providerId: 'stripe',
    getSubscription: jest.fn(() =>
      options.gatewayFails
        ? Promise.reject(new Error('stripe fora'))
        : Promise.resolve(options.remote ?? null),
    ),
    getLatestSubscriptionByCustomer: jest.fn(() =>
      options.gatewayFails
        ? Promise.reject(new Error('stripe fora'))
        : Promise.resolve(options.remote ?? null),
    ),
  };
  const eventEmitter = { emit: jest.fn() };

  const service = new AdminAccountStatusService(
    dataSource as never,
    userRepository as never,
    subscriptionRepo as never,
    audit as never,
    sessionRevocation as never,
    gateway as never,
    eventEmitter as never,
  );
  return {
    service,
    writes,
    userRepository,
    audit,
    sessionRevocation,
    gateway,
    eventEmitter,
  };
}

describe('AdminAccountStatusService', () => {
  describe('deactivate', () => {
    it('marca a conta no dono, derruba as sessões de todos e audita', async () => {
      const h = build();

      const result = await h.service.deactivate(OWNER, ACTOR, REASON, NOW);

      expect(h.writes).toEqual([{ at: NOW, byId: ACTOR }]);
      expect(h.sessionRevocation.revokeAllSessions).toHaveBeenCalledWith(
        OWNER,
        'account_deactivated',
      );
      expect(h.sessionRevocation.revokeAllSessions).toHaveBeenCalledWith(
        'user-2',
        'account_deactivated',
      );
      expect(h.eventEmitter.emit).toHaveBeenCalledWith('user.access_changed', {
        userId: 'user-2',
        phone: '11999990001',
      });
      expect(h.audit.begin).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: ACTOR,
          action: PlatformAuditAction.ACCOUNT_DEACTIVATED,
          targetOwnerId: OWNER,
          reason: REASON,
          before: { accountDeactivatedAt: null, accountDeactivatedById: null },
        }),
      );
      expect(h.audit.succeed).toHaveBeenCalledWith('audit-1', {
        after: {
          accountDeactivatedAt: NOW.toISOString(),
          accountDeactivatedById: ACTOR,
          revokedUsers: 2,
          revocationFailures: 0,
        },
        gatewayRef: null,
      });
      expect(result).toEqual({
        auditLogId: 'audit-1',
        accountDeactivatedAt: NOW,
        revokedUsers: 2,
      });
    });

    it('derruba as sessões dos membros em paralelo, sem esperar um terminar para começar o outro', async () => {
      const h = build();
      const pendentes: Array<() => void> = [];
      h.sessionRevocation.revokeAllSessions.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pendentes.push(resolve);
          }),
      );

      const promessa = h.service.deactivate(OWNER, ACTOR, REASON, NOW);
      await new Promise((resolve) => setImmediate(resolve));

      expect(h.sessionRevocation.revokeAllSessions).toHaveBeenCalledTimes(2);
      pendentes.forEach((resolve) => resolve());
      await expect(promessa).resolves.toMatchObject({ revokedUsers: 2 });
    });

    it('acesso interno pode ser desativado sem consultar a Stripe', async () => {
      const h = build({
        sub: {
          status: SubscriptionStatus.INTERNAL,
          gatewayCustomerId: 'cus-1',
        },
      });

      await h.service.deactivate(OWNER, ACTOR, REASON, NOW);

      expect(h.gateway.getLatestSubscriptionByCustomer).not.toHaveBeenCalled();
      expect(h.writes).toHaveLength(1);
    });

    it('assinatura cancelada na Stripe não impede a desativação', async () => {
      const h = build({
        sub: {
          status: SubscriptionStatus.CANCELED,
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-1',
        },
        remote: gatewaySub({ status: 'canceled', providerStatus: 'canceled' }),
      });

      await h.service.deactivate(OWNER, ACTOR, REASON, NOW);

      expect(h.writes).toHaveLength(1);
    });

    it('cobrança viva na Stripe → 409 com orientação, nada muda e auditoria failed', async () => {
      const h = build({
        sub: {
          status: SubscriptionStatus.ACTIVE,
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-1',
        },
        remote: gatewaySub(),
      });

      await expect(
        h.service.deactivate(OWNER, ACTOR, REASON, NOW),
      ).rejects.toThrow(
        new ConflictException(MENSAGEM_DESATIVAR_COM_ASSINATURA),
      );
      expect(h.writes).toEqual([]);
      expect(h.sessionRevocation.revokeAllSessions).not.toHaveBeenCalled();
      expect(h.audit.fail).toHaveBeenCalledWith(
        'audit-1',
        MENSAGEM_DESATIVAR_COM_ASSINATURA,
        null,
      );
    });

    it('Stripe fora → 503 e nada muda', async () => {
      const h = build({
        sub: { gatewayCustomerId: 'cus-1' },
        gatewayFails: true,
      });

      await expect(
        h.service.deactivate(OWNER, ACTOR, REASON, NOW),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(h.writes).toEqual([]);
      expect(h.audit.fail).toHaveBeenCalled();
    });

    it('já desativada → 409 sem abrir auditoria', async () => {
      const h = build({ owner: { accountDeactivatedAt: NOW } });

      await expect(
        h.service.deactivate(OWNER, ACTOR, REASON, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(h.audit.begin).not.toHaveBeenCalled();
    });

    it('conta inexistente → 404', async () => {
      const h = build({ owner: null });

      await expect(
        h.service.deactivate(OWNER, ACTOR, REASON, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('falha ao derrubar a sessão de um usuário não desfaz a desativação', async () => {
      const h = build({ revokeFailsFor: 'user-2' });

      const result = await h.service.deactivate(OWNER, ACTOR, REASON, NOW);

      expect(result.revokedUsers).toBe(1);
      expect(h.writes).toHaveLength(1);
      expect(h.audit.succeed).toHaveBeenCalledWith(
        'audit-1',
        expect.objectContaining({
          after: expect.objectContaining({ revocationFailures: 1 }),
        }),
      );
    });
  });

  describe('reactivate', () => {
    it('limpa a marca do dono e audita', async () => {
      const h = build({ owner: { accountDeactivatedAt: NOW } });

      const result = await h.service.reactivate(OWNER, ACTOR, REASON);

      expect(h.writes).toEqual([{ at: null, byId: null }]);
      expect(h.audit.begin).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PlatformAuditAction.ACCOUNT_REACTIVATED,
          targetOwnerId: OWNER,
        }),
      );
      expect(h.sessionRevocation.revokeAllSessions).not.toHaveBeenCalled();
      expect(result).toEqual({
        auditLogId: 'audit-1',
        accountDeactivatedAt: null,
        revokedUsers: 0,
      });
    });

    it('conta ativa → 409', async () => {
      const h = build();

      await expect(
        h.service.reactivate(OWNER, ACTOR, REASON),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(h.writes).toEqual([]);
    });
  });
});
