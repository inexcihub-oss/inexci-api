import { Module, Logger, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PAYMENT_GATEWAY } from './payment-gateway.interface';
import { StripeProvider } from './providers/stripe/stripe.provider';

const paymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  useFactory: (stripe: StripeProvider) => {
    const logger = new Logger('PaymentGatewayFactory');
    logger.log('Provider de pagamento ativo: stripe');
    return stripe;
  },
  inject: [StripeProvider],
};

@Module({
  imports: [ConfigModule],
  providers: [StripeProvider, paymentGatewayProvider],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentGatewayModule {}
