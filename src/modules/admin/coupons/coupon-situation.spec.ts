import { couponSituation } from './coupon-situation';

describe('couponSituation', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const base = {
    active: true,
    valid: true,
    expiresAt: null,
    maxRedemptions: null,
    timesRedeemed: 0,
  };

  it('ativo quando nada o impede', () => {
    expect(couponSituation(base, now)).toBe('ativo');
    expect(
      couponSituation(
        {
          ...base,
          maxRedemptions: 5,
          timesRedeemed: 4,
          expiresAt: new Date('2026-12-01'),
        },
        now,
      ),
    ).toBe('ativo');
  });

  it('esgotado quando os usos chegam ao limite', () => {
    expect(
      couponSituation({ ...base, maxRedemptions: 5, timesRedeemed: 5 }, now),
    ).toBe('esgotado');
    expect(
      couponSituation(
        { ...base, active: false, maxRedemptions: 1, timesRedeemed: 1 },
        now,
      ),
    ).toBe('esgotado');
  });

  it('expirado quando a validade passou, mesmo se a Stripe já inativou', () => {
    expect(
      couponSituation({ ...base, expiresAt: new Date('2026-10-01') }, now),
    ).toBe('expirado');
    expect(
      couponSituation(
        { ...base, active: false, expiresAt: new Date('2026-10-24T12:00:00Z') },
        now,
      ),
    ).toBe('expirado');
  });

  it('desativado quando inativo sem esgotar nem expirar, ou cupom inválido', () => {
    expect(couponSituation({ ...base, active: false }, now)).toBe('desativado');
    expect(couponSituation({ ...base, valid: false }, now)).toBe('desativado');
  });
});
