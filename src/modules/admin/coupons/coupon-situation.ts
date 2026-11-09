import { GatewayCoupon } from 'src/shared/payment-gateway/payment-gateway.types';
import { CouponSituation } from './dto/admin-coupons.dto';

export function couponSituation(
  coupon: Pick<
    GatewayCoupon,
    'active' | 'valid' | 'expiresAt' | 'maxRedemptions' | 'timesRedeemed'
  >,
  now: Date = new Date(),
): CouponSituation {
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
    return 'expirado';
  }
  if (
    coupon.maxRedemptions !== null &&
    coupon.timesRedeemed >= coupon.maxRedemptions
  ) {
    return 'esgotado';
  }
  if (!coupon.active || !coupon.valid) return 'desativado';
  return 'ativo';
}
