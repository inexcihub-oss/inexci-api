import type { Subscription } from 'src/database/entities/subscription.entity';
import type { GatewayDiscount } from 'src/shared/payment-gateway/payment-gateway.types';

export type SubscriptionDiscountColumns = Pick<
  Subscription,
  | 'discountPercentOff'
  | 'discountAmountOffCents'
  | 'discountDuration'
  | 'discountEndsAt'
>;

export function discountColumnsFrom(
  discount: GatewayDiscount | null,
): SubscriptionDiscountColumns {
  if (!discount || !discount.duration) {
    return {
      discountPercentOff: null,
      discountAmountOffCents: null,
      discountDuration: null,
      discountEndsAt: null,
    };
  }
  return {
    discountPercentOff: discount.percentOff ?? null,
    discountAmountOffCents: discount.amountOffCents ?? null,
    discountDuration: discount.duration,
    discountEndsAt: discount.endsAt ?? null,
  };
}
