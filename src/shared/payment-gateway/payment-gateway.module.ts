import { Module, Logger, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PAYMENT_GATEWAY } from './payment-gateway.interface';
import { AsaasHttpClient } from './providers/asaas/asaas-http.client';
import { AsaasProvider } from './providers/asaas/asaas.provider';

/**
 * M\u00f3dulo respons\u00e1vel por expor a interface gen\u00e9rica `PaymentGateway`
 * (via token `PAYMENT_GATEWAY`). A implementa\u00e7\u00e3o concreta \u00e9 escolhida
 * via env `PAYMENT_GATEWAY_PROVIDER` (`asaas` por padr\u00e3o).
 *
 * Para adicionar um novo provider:
 * 1. Crie a pasta `providers/<nome>/` com a implementa\u00e7\u00e3o de `PaymentGateway`.
 * 2. Registre o providerClass aqui no factory abaixo.
 * 3. Documente as vari\u00e1veis de ambiente necess\u00e1rias.
 */

const paymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  useFactory: (config: ConfigService, asaas: AsaasProvider) => {
    const providerName = (
      config.get<string>('PAYMENT_GATEWAY_PROVIDER', 'asaas') || 'asaas'
    ).toLowerCase();

    const logger = new Logger('PaymentGatewayFactory');
    switch (providerName) {
      case 'asaas':
        logger.log('Provider de pagamento ativo: asaas');
        return asaas;
      default:
        throw new Error(
          `PAYMENT_GATEWAY_PROVIDER desconhecido: "${providerName}". ` +
            `Valores suportados: asaas.`,
        );
    }
  },
  inject: [ConfigService, AsaasProvider],
};

@Module({
  imports: [ConfigModule],
  providers: [AsaasHttpClient, AsaasProvider, paymentGatewayProvider],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentGatewayModule {}
