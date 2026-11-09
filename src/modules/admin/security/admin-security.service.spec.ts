import { LokiUnavailableError } from '../errors/grafana-loki.client';
import {
  AdminSecurityService,
  groupSecurityByUser,
  toSecurityTotals,
} from './admin-security.service';
import {
  LOGIN_FAILURE_SPIKE_PER_ACCOUNT,
  LOGIN_FAILURE_SPIKE_PLATFORM,
} from './security.config';

const now = new Date('2026-10-28T15:00:00Z');

function build() {
  const security = {
    totalsByType: jest.fn().mockResolvedValue([
      { eventType: 'login_failed', total: 4 },
      { eventType: 'refresh_reuse', total: 1 },
    ]),
    unattributedTotal: jest.fn().mockResolvedValue(6),
    dailySeries: jest
      .fn()
      .mockResolvedValue([
        { day: '2026-10-28', eventType: 'login_failed', total: 4 },
      ]),
    topAccounts: jest.fn().mockResolvedValue([]),
    byUser: jest.fn().mockResolvedValue([
      {
        userId: 'u1',
        userName: 'Ana',
        eventType: 'login_failed',
        total: 3,
        lastSeenAt: new Date('2026-10-27T10:00:00Z'),
        lastRequestId: 'r1',
      },
      {
        userId: 'u1',
        userName: 'Ana',
        eventType: 'refresh_reuse',
        total: 1,
        lastSeenAt: new Date('2026-10-28T10:00:00Z'),
        lastRequestId: 'r2',
      },
      {
        userId: 'u2',
        userName: 'Bia',
        eventType: 'mfa_enabled',
        total: 1,
        lastSeenAt: new Date('2026-10-26T10:00:00Z'),
        lastRequestId: null,
      },
    ]),
    loginFailuresSince: jest.fn().mockResolvedValue({
      total: LOGIN_FAILURE_SPIKE_PLATFORM,
      accounts: [
        {
          ownerId: 'o1',
          ownerName: 'A',
          total: LOGIN_FAILURE_SPIKE_PER_ACCOUNT + 2,
          users: 1,
          lastSeenAt: now,
        },
        { ownerId: 'o2', ownerName: 'B', total: 2, users: 1, lastSeenAt: now },
      ],
    }),
    mfaCoverage: jest.fn().mockResolvedValue({ activeUsers: 5, withoutMfa: 2 }),
  };
  const loki = {
    isConfigured: jest.fn().mockReturnValue(true),
    searchUserEvents: jest.fn().mockResolvedValue([
      {
        timestamp: now,
        level: 'warn',
        message: '[AUTH_MFA_LOCKED] userId=u1 ip=189.40.12.201',
        context: 'MfaService',
        requestId: 'r9',
        traceId: null,
      },
    ]),
  };
  const service = new AdminSecurityService(security as never, loki as never);
  return { service, security, loki };
}

describe('AdminSecurityService', () => {
  it('toSecurityTotals preenche todos os tipos com zero', () => {
    expect(toSecurityTotals([{ eventType: 'mfa_failed', total: 2 }])).toEqual({
      login_failed: 0,
      login_locked: 0,
      mfa_failed: 2,
      refresh_reuse: 0,
      password_changed: 0,
      mfa_enabled: 0,
      mfa_disabled: 0,
    });
  });

  it('groupSecurityByUser soma falhas e sessões derrubadas e ordena por gravidade', () => {
    const users = groupSecurityByUser([
      {
        userId: 'u2',
        userName: 'Bia',
        eventType: 'mfa_enabled',
        total: 1,
        lastSeenAt: now,
        lastRequestId: null,
      },
      {
        userId: 'u1',
        userName: 'Ana',
        eventType: 'login_failed',
        total: 3,
        lastSeenAt: new Date('2026-10-27T10:00:00Z'),
        lastRequestId: null,
      },
      {
        userId: 'u1',
        userName: 'Ana',
        eventType: 'password_changed',
        total: 1,
        lastSeenAt: now,
        lastRequestId: null,
      },
    ]);
    expect(users.map((u) => u.userId)).toEqual(['u1', 'u2']);
    expect(users[0]).toMatchObject({
      failures: 3,
      sessionsRevoked: 1,
      lastSeenAt: now,
    });
    expect(users[1]).toMatchObject({ failures: 0, sessionsRevoked: 0 });
  });

  it('spike marca contas acima do limiar e o pico da plataforma', async () => {
    const { service, security } = build();
    const spike = await service.spike(now);
    expect(security.loginFailuresSince).toHaveBeenCalledWith(
      new Date('2026-10-27T15:00:00Z'),
      '2026-10-27',
    );
    expect(spike).toMatchObject({
      platformSpike: true,
      platformTotal24h: LOGIN_FAILURE_SPIKE_PLATFORM,
      accountsWithSpike24h: 1,
    });
    expect(spike.topSpikeAccounts.map((a) => a.ownerId)).toEqual(['o1']);
  });

  it('overview junta totais, contas com falha, contas com reuso e cobertura de MFA', async () => {
    const { service, security } = build();
    const overview = await service.overview({ days: 7 }, now);
    expect(overview.fromDay).toBe('2026-10-22');
    expect(overview.toDay).toBe('2026-10-28');
    expect(overview.totals.login_failed).toBe(4);
    expect(overview.unattributedLocks).toBe(6);
    expect(security.topAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTypes: ['login_failed', 'login_locked', 'mfa_failed'],
      }),
    );
    expect(security.topAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypes: ['refresh_reuse'] }),
    );
    expect(overview.mfa).toEqual({ activeUsers: 5, withoutMfa: 2 });
    expect(overview.lokiAvailable).toBe(true);
  });

  it('forAccount filtra pela conta e agrupa por usuário', async () => {
    const { service, security } = build();
    const result = await service.forAccount('o1', {}, now);
    expect(security.byUser).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o1', fromDay: '2026-09-29' }),
    );
    expect(security.mfaCoverage).toHaveBeenCalledWith('o1');
    expect(result.users[0]).toMatchObject({
      userId: 'u1',
      failures: 3,
      sessionsRevoked: 1,
    });
  });

  it('logs vêm do Loki pelos usuários da conta, com IP mascarado', async () => {
    const { service, loki } = build();
    const result = await service.logsForAccount('o1', { days: 7 }, now);
    expect(loki.searchUserEvents).toHaveBeenCalledWith(
      ['u1', 'u2'],
      'AUTH_',
      expect.objectContaining({ to: now }),
    );
    expect(result.logs[0].message).toBe(
      '[AUTH_MFA_LOCKED] userId=u1 ip=189.40.12.x',
    );
    expect(result.lokiError).toBeNull();
  });

  it('sem Loki configurado devolve só o aviso, sem consultar nada', async () => {
    const { service, loki, security } = build();
    loki.isConfigured.mockReturnValue(false);
    const result = await service.logsForAccount('o1', {}, now);
    expect(result).toEqual({
      logs: [],
      lokiAvailable: false,
      lokiError: 'not_configured',
    });
    expect(security.byUser).not.toHaveBeenCalled();
  });

  it('Loki fora do ar vira aviso, não erro', async () => {
    const { service, loki } = build();
    loki.searchUserEvents.mockRejectedValue(new LokiUnavailableError('x'));
    const result = await service.logsForAccount('o1', {}, now);
    expect(result).toEqual({
      logs: [],
      lokiAvailable: true,
      lokiError: 'unavailable',
    });
  });
});
