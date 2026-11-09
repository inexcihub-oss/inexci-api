import { backfillMetrics, reconstructDay } from './backfill-metrics';

describe('backfill de métricas', () => {
  function repo() {
    return {
      earliestClientCreatedAt: jest
        .fn()
        .mockResolvedValue(new Date('2026-10-20T15:00:00Z')),
      countCreatedBetween: jest.fn(({ from }: { from?: Date }) =>
        Promise.resolve(from ? 1 : 12),
      ),
      countCanceledBetween: jest.fn().mockResolvedValue(0),
      reconstructMrrAt: jest
        .fn()
        .mockResolvedValue({ mrrCents: 54816, payingAccounts: 2 }),
      upsertReconstructedSnapshot: jest.fn().mockResolvedValue(true),
    };
  }

  it('reconstrói o dia com novas/canceladas pelas datas, MRR pelas faturas e o resto NULL', async () => {
    const r = repo();

    const row = await reconstructDay(r, '2026-10-21');

    expect(r.countCreatedBetween).toHaveBeenCalledWith({
      from: new Date('2026-10-21T03:00:00Z'),
      to: new Date('2026-10-22T03:00:00Z'),
    });
    expect(r.countCreatedBetween).toHaveBeenCalledWith({
      to: new Date('2026-10-22T03:00:00Z'),
    });
    expect(r.reconstructMrrAt).toHaveBeenCalledWith(
      new Date('2026-10-22T03:00:00Z'),
    );
    expect(row).toEqual({
      day: '2026-10-21',
      accountsTotal: 12,
      accountsBySituation: null,
      mrrCents: 54816,
      payingAccounts: 2,
      trialAccounts: null,
      newAccounts: 1,
      canceledAccounts: 0,
      activeAccounts7d: null,
      activeAccounts30d: null,
    });
  });

  it('vai do primeiro dia com conta até ontem (SP) e conta os dias que o cron já gravou como pulados', async () => {
    const r = repo();
    r.upsertReconstructedSnapshot
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await backfillMetrics({
      repo: r,
      now: new Date('2026-10-24T15:00:00Z'),
      log: jest.fn(),
    });

    const dias = r.upsertReconstructedSnapshot.mock.calls.map(
      (c: [{ day: string }]) => c[0].day,
    );
    expect(dias).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(result).toEqual({ days: 4, written: 3, skipped: 1 });
  });

  it('é idempotente: rodar de novo grava exatamente as mesmas linhas', async () => {
    const r = repo();
    const deps = {
      repo: r,
      fromDay: '2026-10-22',
      now: new Date('2026-10-24T15:00:00Z'),
      log: jest.fn(),
    };

    await backfillMetrics(deps);
    await backfillMetrics(deps);

    const calls = r.upsertReconstructedSnapshot.mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[2]).toEqual(calls[0]);
    expect(calls[3]).toEqual(calls[1]);
  });

  it('sem nenhuma conta não grava nada', async () => {
    const r = repo();
    r.earliestClientCreatedAt.mockResolvedValue(null);

    const result = await backfillMetrics({
      repo: r,
      now: new Date('2026-10-24T15:00:00Z'),
      log: jest.fn(),
    });

    expect(result).toEqual({ days: 0, written: 0, skipped: 0 });
    expect(r.upsertReconstructedSnapshot).not.toHaveBeenCalled();
  });
});
