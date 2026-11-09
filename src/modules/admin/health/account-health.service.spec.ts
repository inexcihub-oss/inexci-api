import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import {
  AccountHealthInput,
  AccountHealthRepository,
} from 'src/database/repositories/account-health.repository';
import { AccountHealthService } from './account-health.service';

const now = new Date('2026-10-28T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function input(over: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    ownerId: 'o1',
    ownerCreatedAt: new Date(now.getTime() - 100 * DAY),
    deactivated: false,
    status: SubscriptionStatus.ACTIVE,
    trialEndsAt: null,
    hasGatewaySubscription: true,
    pastDueSince: null,
    lastSeenAt: new Date(now.getTime() - DAY),
    usageCurrent: 5,
    usagePrevious: 5,
    quotaUsed: null,
    quotaLimit: null,
    errors: 0,
    deliveryFailures: 0,
    ...over,
  };
}

describe('AccountHealthService', () => {
  const repo = {
    loadInputs: jest.fn(),
    upsertMany: jest.fn(),
    deleteDayExcept: jest.fn(),
    purgeBefore: jest.fn(),
    latestComputedAt: jest.fn(),
    latestForOwners: jest.fn(),
    history: jest.fn(),
    countAtRisk: jest.fn(),
    topAtRisk: jest.fn(),
  };
  let service: AccountHealthService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.upsertMany.mockResolvedValue(undefined);
    repo.deleteDayExcept.mockResolvedValue(undefined);
    repo.purgeBefore.mockResolvedValue(0);
    service = new AccountHealthService(
      repo as unknown as AccountHealthRepository,
    );
  });

  it('janela: uso nos últimos 7 dias contra os 7 anteriores, erros em 3 dias (São Paulo) e envios em 72 h', () => {
    expect(service.window(now)).toEqual({
      now,
      usageCurrentFrom: new Date('2026-10-21T15:00:00Z'),
      usagePreviousFrom: new Date('2026-10-14T15:00:00Z'),
      errorsFromDay: '2026-10-26',
      deliveryFrom: new Date('2026-10-25T15:00:00Z'),
    });
  });

  it('refresh grava a nota do dia de cada conta avaliada, tira do dia quem saiu da avaliação e apaga o que tem mais de 90 dias', async () => {
    repo.loadInputs.mockResolvedValue([
      input({ ownerId: 'o1' }),
      input({ ownerId: 'o2', errors: 6 }),
      input({ ownerId: 'o3', status: SubscriptionStatus.CANCELED }),
      input({ ownerId: 'o4', deactivated: true }),
    ]);

    const count = await service.refresh(now);

    expect(count).toBe(2);
    expect(repo.loadInputs).toHaveBeenCalledWith(service.window(now));
    expect(repo.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        ownerId: 'o1',
        day: '2026-10-28',
        score: 100,
        band: 'healthy',
        computedAt: now,
      }),
      expect.objectContaining({
        ownerId: 'o2',
        score: 92,
        factors: [expect.objectContaining({ key: 'errors', points: 8 })],
      }),
    ]);
    expect(repo.deleteDayExcept).toHaveBeenCalledWith('2026-10-28', [
      'o1',
      'o2',
    ]);
    expect(repo.purgeBefore).toHaveBeenCalledWith('2026-07-30');
  });

  it('refresh simultâneos compartilham o mesmo cálculo', async () => {
    let release: (value: AccountHealthInput[]) => void = () => {};
    repo.loadInputs.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const a = service.refresh(now);
    const b = service.refresh(now);
    release([input()]);

    await expect(Promise.all([a, b])).resolves.toEqual([1, 1]);
    expect(repo.loadInputs).toHaveBeenCalledTimes(1);
  });

  describe('ensureFresh', () => {
    beforeEach(() => repo.loadInputs.mockResolvedValue([]));

    it('recalcula quando nunca calculou', async () => {
      repo.latestComputedAt.mockResolvedValue(null);
      await service.ensureFresh(now);
      expect(repo.loadInputs).toHaveBeenCalled();
    });

    it('recalcula quando o último cálculo tem mais de 2 h', async () => {
      repo.latestComputedAt.mockResolvedValue(
        new Date(now.getTime() - 3 * 60 * 60 * 1000),
      );
      await service.ensureFresh(now);
      expect(repo.loadInputs).toHaveBeenCalled();
    });

    it('recalcula na virada do dia de São Paulo', async () => {
      const justAfterMidnight = new Date('2026-10-29T03:10:00Z');
      repo.latestComputedAt.mockResolvedValue(new Date('2026-10-29T02:50:00Z'));
      await service.ensureFresh(justAfterMidnight);
      expect(repo.loadInputs).toHaveBeenCalled();
    });

    it('não recalcula quando o cálculo é recente', async () => {
      repo.latestComputedAt.mockResolvedValue(
        new Date(now.getTime() - 30 * 60 * 1000),
      );
      await service.ensureFresh(now);
      expect(repo.loadInputs).not.toHaveBeenCalled();
    });

    it('falha no cálculo não derruba quem pediu', async () => {
      repo.latestComputedAt.mockRejectedValue(new Error('db fora'));
      await expect(service.ensureFresh(now)).resolves.toBeUndefined();
    });
  });

  it('computeOne calcula ao vivo só para a conta pedida', async () => {
    repo.loadInputs.mockResolvedValue([input({ ownerId: 'o9', errors: 1 })]);

    const result = await service.computeOne('o9', now);

    expect(repo.loadInputs).toHaveBeenCalledWith(service.window(now), ['o9']);
    expect(result).toMatchObject({ score: 97, band: 'healthy' });
  });

  it('computeOne devolve null para conta sem assinatura ou fora da avaliação', async () => {
    repo.loadInputs.mockResolvedValue([]);
    await expect(service.computeOne('o9', now)).resolves.toBeNull();
  });

  it('histórico dos últimos 30 dias', async () => {
    repo.history.mockResolvedValue([]);
    await service.history('o1', now);
    expect(repo.history).toHaveBeenCalledWith('o1', '2026-09-29');
  });

  it('contas em risco: total e as piores', async () => {
    repo.countAtRisk.mockResolvedValue(4);
    repo.topAtRisk.mockResolvedValue([{ ownerId: 'o1' }]);
    await expect(service.atRisk(5)).resolves.toEqual({
      total: 4,
      items: [{ ownerId: 'o1' }],
    });
    expect(repo.topAtRisk).toHaveBeenCalledWith(5);
  });

  it('o cron registra a falha sem propagar', async () => {
    repo.loadInputs.mockRejectedValue(new Error('db fora'));
    await expect(service.handleHourlySnapshot()).resolves.toBeUndefined();
  });
});
