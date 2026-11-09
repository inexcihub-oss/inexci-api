import { NotFoundException } from '@nestjs/common';
import { NotificationSendStatus } from 'src/database/entities/notification-send-log.entity';
import { AdminErrorsService } from './admin-errors.service';
import { LokiUnavailableError } from './grafana-loki.client';

const now = new Date('2026-10-28T15:00:00Z');
const FP = 'a'.repeat(64);

function build(opts: { loki?: boolean; explore?: boolean } = {}) {
  const errors = {
    totals: jest
      .fn()
      .mockResolvedValue({ total: 12, accounts: 3, fingerprints: 2 }),
    dailySeries: jest
      .fn()
      .mockResolvedValue([{ day: '2026-10-27', source: 'http', total: 12 }]),
    topFingerprints: jest.fn().mockResolvedValue({
      items: [
        {
          fingerprint: FP,
          source: 'http',
          errorClass: 'TypeError',
          route: 'GET /x',
          lastMessage: 'boom',
          total: 12,
          accounts: 3,
          firstSeenAt: new Date('2026-10-20T10:00:00Z'),
          lastSeenAt: new Date('2026-10-27T10:00:00Z'),
          lastRequestId: 'req-1',
          lastTraceId: 'tr-1',
        },
      ],
      total: 1,
    }),
    topAccounts: jest.fn().mockResolvedValue([
      {
        ownerId: 'o1',
        ownerName: 'A',
        total: 9,
        fingerprints: 1,
        lastSeenAt: now,
      },
    ]),
    occurrencesOf: jest.fn().mockResolvedValue([
      {
        day: '2026-10-27',
        ownerId: 'o1',
        ownerName: 'A',
        count: 4,
        lastSeenAt: new Date('2026-10-27T10:00:00Z'),
        lastRequestId: 'req-1',
        lastTraceId: 'tr-1',
        lastMessage: 'boom',
        route: 'GET /x',
      },
      {
        day: '2026-10-26',
        ownerId: 'o2',
        ownerName: 'B',
        count: 1,
        lastSeenAt: new Date('2026-10-26T10:00:00Z'),
        lastRequestId: null,
        lastTraceId: null,
        lastMessage: 'boom',
        route: 'GET /x',
      },
    ]),
  };
  const sendLogs = {
    stats: jest.fn().mockResolvedValue([
      { channel: 'email', status: 'failed', count: 2 },
      { channel: 'whatsapp', status: 'failed', count: 5 },
    ]),
  };
  const loki = {
    service: 'inexci-api',
    isConfigured: jest.fn().mockReturnValue(opts.loki ?? false),
    searchByRequestIds: jest.fn().mockResolvedValue([
      {
        timestamp: now,
        level: 'error',
        message: 'stack',
        context: null,
        requestId: 'req-1',
        traceId: null,
      },
    ]),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'GRAFANA_EXPLORE_URL' && opts.explore
        ? 'https://g.net/explore'
        : undefined,
    ),
  };
  const service = new AdminErrorsService(
    errors as never,
    sendLogs as never,
    loki as never,
    config as never,
  );
  return { service, errors, sendLogs, loki };
}

describe('AdminErrorsService', () => {
  it('overview: período de 30 dias em São Paulo, totais com envios falhos, ranking e contas', async () => {
    const { service, errors, sendLogs } = build({ explore: true });

    const result = await service.overview({}, now);

    expect(errors.totals).toHaveBeenCalledWith({
      fromDay: '2026-09-29',
      toDay: '2026-10-28',
      source: undefined,
      ownerId: undefined,
    });
    expect(errors.topFingerprints).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
    expect(sendLogs.stats).toHaveBeenCalledWith({
      status: NotificationSendStatus.FAILED,
      ownerId: undefined,
      from: new Date('2026-09-29T03:00:00Z'),
      to: new Date('2026-10-29T03:00:00Z'),
    });
    expect(result.totals).toEqual({
      total: 12,
      accounts: 3,
      fingerprints: 2,
      failedDeliveries: 7,
    });
    expect(result.fingerprints.items[0].exploreUrl).toContain(
      'https://g.net/explore?',
    );
    expect(result.accounts).toHaveLength(1);
    expect(result.lokiAvailable).toBe(false);
  });

  it('filtro por outra origem não soma envios falhos', async () => {
    const { service, sendLogs } = build();
    const result = await service.overview({ source: 'queue', days: 7 }, now);
    expect(sendLogs.stats).not.toHaveBeenCalled();
    expect(result.totals.failedDeliveries).toBe(0);
    expect(result.fromDay).toBe('2026-10-22');
  });

  it('por conta: filtra pelo dono em tudo, inclusive nos envios', async () => {
    const { service, errors, sendLogs } = build();
    const result = await service.forAccount('o1', { days: 1 }, now);
    expect(errors.totals).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o1', fromDay: '2026-10-28' }),
    );
    expect(sendLogs.stats).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o1' }),
    );
    expect(result.ownerId).toBe('o1');
    expect(result.fingerprints.items[0].exploreUrl).toBeNull();
  });

  it('ocorrências sem Loki configurado: só as contagens', async () => {
    const { service, loki } = build({ loki: false });
    const result = await service.occurrences(FP, {}, now);
    expect(result.occurrences).toHaveLength(2);
    expect(result.logs).toEqual([]);
    expect(result.lokiError).toBe('not_configured');
    expect(loki.searchByRequestIds).not.toHaveBeenCalled();
  });

  it('ocorrências com Loki: busca pelos requestIds numa janela com margem', async () => {
    const { service, loki } = build({ loki: true });
    const result = await service.occurrences(FP, {}, now);
    expect(loki.searchByRequestIds).toHaveBeenCalledWith(['req-1'], {
      from: new Date('2026-10-27T09:50:00Z'),
      to: new Date('2026-10-27T10:10:00Z'),
      limit: 50,
    });
    expect(result.logs).toHaveLength(1);
    expect(result.lokiError).toBeNull();
  });

  it('Loki fora do ar não derruba a tela', async () => {
    const { service, loki } = build({ loki: true });
    loki.searchByRequestIds.mockRejectedValue(new LokiUnavailableError('x'));
    const result = await service.occurrences(FP, {}, now);
    expect(result.lokiError).toBe('unavailable');
    expect(result.occurrences).toHaveLength(2);
  });

  it('erro inexistente no período vira 404', async () => {
    const { service, errors } = build();
    errors.occurrencesOf.mockResolvedValue([]);
    await expect(service.occurrences(FP, {}, now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
