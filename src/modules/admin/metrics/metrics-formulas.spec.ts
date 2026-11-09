import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import type { Subscription } from 'src/database/entities/subscription.entity';
import {
  changePercent,
  lostMrrCents,
  monthKeysEndingAt,
  mrrMonthlySeries,
  periodStart,
  ratePercent,
  saoPauloDayRangeOf,
  shiftDayKey,
  snapshotOnOrBefore,
} from './metrics-formulas';

describe('metrics-formulas', () => {
  const now = new Date('2026-10-24T15:00:00Z');

  describe('periodStart', () => {
    it('30d e 90d voltam dias corridos; 12m volta 12 meses de calendário', () => {
      expect(periodStart('30d', now)).toEqual(new Date('2026-09-24T15:00:00Z'));
      expect(periodStart('90d', now)).toEqual(new Date('2026-07-26T15:00:00Z'));
      expect(periodStart('12m', now)).toEqual(new Date('2025-10-24T15:00:00Z'));
    });
  });

  describe('ratePercent', () => {
    it('3 de 12 = 25%; 1 de 3 = 33,3% (uma casa)', () => {
      expect(ratePercent(3, 12)).toBe(25);
      expect(ratePercent(1, 3)).toBe(33.3);
      expect(ratePercent(2, 3)).toBe(66.7);
    });

    it('zero no numerador com base é 0%, não null', () => {
      expect(ratePercent(0, 10)).toBe(0);
    });

    it('sem base (0 ou null) devolve null, nunca zero', () => {
      expect(ratePercent(0, 0)).toBeNull();
      expect(ratePercent(5, null)).toBeNull();
    });
  });

  describe('changePercent', () => {
    it('de 100.000 para 112.500 = +12,5%; de 80.000 para 60.000 = -25%', () => {
      expect(changePercent(112500, 100000)).toBe(12.5);
      expect(changePercent(60000, 80000)).toBe(-25);
    });

    it('sem histórico ou base zero devolve null', () => {
      expect(changePercent(50000, null)).toBeNull();
      expect(changePercent(50000, 0)).toBeNull();
    });
  });

  describe('dias e meses no fuso de São Paulo', () => {
    it('shiftDayKey atravessa mês e ano', () => {
      expect(shiftDayKey('2026-10-01', -1)).toBe('2026-09-30');
      expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
      expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('o dia 23/10 em SP vai de 03:00Z do dia 23 a 03:00Z do dia 24', () => {
      expect(saoPauloDayRangeOf('2026-10-23')).toEqual({
        from: new Date('2026-10-23T03:00:00Z'),
        to: new Date('2026-10-24T03:00:00Z'),
      });
    });

    it('monthKeysEndingAt devolve 12 meses em ordem, cruzando o ano', () => {
      const keys = monthKeysEndingAt('2026-10', 12);
      expect(keys).toHaveLength(12);
      expect(keys[0]).toBe('2025-11');
      expect(keys[11]).toBe('2026-10');
      expect(keys).toContain('2026-01');
    });
  });

  describe('snapshotOnOrBefore', () => {
    const snaps = [
      { day: '2026-09-25', mrrCents: 90000, payingAccounts: 9 },
      { day: '2026-09-28', mrrCents: 95000, payingAccounts: 10 },
      { day: '2026-09-30', mrrCents: 100000, payingAccounts: 11 },
    ];

    it('pega o próprio dia quando existe', () => {
      expect(snapshotOnOrBefore(snaps, '2026-09-30')?.mrrCents).toBe(100000);
    });

    it('sem o dia, usa o mais recente dentro da tolerância de 3 dias', () => {
      expect(snapshotOnOrBefore(snaps, '2026-10-01')?.mrrCents).toBe(100000);
      expect(snapshotOnOrBefore(snaps, '2026-09-29')?.mrrCents).toBe(95000);
    });

    it('fora da tolerância ou sem nada antes devolve null', () => {
      expect(snapshotOnOrBefore(snaps, '2026-10-04')).toBeNull();
      expect(snapshotOnOrBefore(snaps, '2026-09-20')).toBeNull();
      expect(snapshotOnOrBefore([], '2026-09-30')).toBeNull();
    });
  });

  describe('mrrMonthlySeries', () => {
    it('mês passado usa o último snapshot do mês, mês corrente usa o MRR ao vivo e mês sem snapshot é null', () => {
      const series = mrrMonthlySeries(
        ['2026-08', '2026-09', '2026-10'],
        [
          { day: '2026-09-10', mrrCents: 70000, payingAccounts: 7 },
          { day: '2026-09-30', mrrCents: 80000, payingAccounts: 8 },
          { day: '2026-10-05', mrrCents: 82000, payingAccounts: 8 },
        ],
        '2026-10',
        91000,
      );

      expect(series).toEqual([
        { month: '2026-08', mrrCents: null },
        { month: '2026-09', mrrCents: 80000 },
        { month: '2026-10', mrrCents: 91000 },
      ]);
    });
  });

  describe('lostMrrCents', () => {
    const sub = (over: Partial<Subscription>): Subscription =>
      ({
        status: SubscriptionStatus.CANCELED,
        trialEndsAt: null,
        canceledAt: new Date('2026-10-10T12:00:00Z'),
        discountPercentOff: null,
        discountAmountOffCents: null,
        discountDuration: null,
        discountEndsAt: null,
        plan: { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ...over,
      }) as Subscription;

    it('soma o valor mensal que cada conta cancelada pagava: 299,00 + 2.990,00/12 (249,16) + 199,00 com 50% = 647,66', () => {
      const total = lostMrrCents([
        sub({}),
        sub({ plan: { priceCents: 299000, billingPeriod: 'YEARLY' } as never }),
        sub({
          plan: { priceCents: 19900, billingPeriod: 'MONTHLY' } as never,
          discountPercentOff: 50,
          discountDuration: 'forever',
        }),
      ]);

      expect(total).toBe(29900 + 24916 + 9950);
    });

    it('lista vazia perde zero', () => {
      expect(lostMrrCents([])).toBe(0);
    });
  });
});
