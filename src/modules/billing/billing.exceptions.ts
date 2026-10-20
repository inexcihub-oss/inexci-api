import { HttpException, HttpStatus } from '@nestjs/common';

export class BillingRequiredException extends HttpException {
  constructor(
    message: string,
    public readonly reason:
      | 'quota_exceeded'
      | 'subscription_suspended'
      | 'subscription_canceled'
      | 'trial_expired'
      | 'payment_method_required',
  ) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        message,
        reason,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
