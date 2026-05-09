import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Exception lan\u00e7ada quando uma a\u00e7\u00e3o exige pagamento/regulariza\u00e7\u00e3o
 * da assinatura: cota mensal atingida, conta suspensa por inadimpl\u00eancia,
 * trial expirado sem cart\u00e3o cadastrado, etc.
 *
 * O frontend usa este status (402 Payment Required) para diferenciar
 * "bloqueio comercial" de "permiss\u00e3o ausente" (403) e abrir o fluxo
 * de upgrade/cadastro de pagamento.
 */
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
