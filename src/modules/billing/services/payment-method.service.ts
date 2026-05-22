import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PaymentMethodRepository } from 'src/database/repositories/payment-method.repository';
import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { PaymentMethod } from 'src/database/entities/payment-method.entity';

import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';

import { SavePaymentMethodDto } from '../dto/save-payment-method.dto';
import { SubscriptionService } from './subscription.service';

/**
 * Serviço de métodos de pagamento.
 *
 * Fluxo de cadastro de cartão:
 * 1. Garante que existe um customer no gateway para o owner (cria se não
 *    existir, reaproveita se já existir em outro PM).
 * 2. Vincula o PaymentMethod criado pelo Stripe.js ao customer.
 * 3. Salva o PaymentMethod local (token + metadados de exibição).
 * 4. Aciona `SubscriptionService.onPaymentMethodAdded` para criar/atualizar
 *    a subscription no gateway (encerrando trial ou suspensão).
 *
 * IMPORTANTE: dados sensíveis (número/CVV) JAMAIS chegam ao backend — o
 * Stripe.js tokeniza no frontend e envia apenas o pm_xxx.
 */
@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(
    private readonly paymentMethodRepo: PaymentMethodRepository,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly userRepo: UserRepository,
    private readonly subscriptionService: SubscriptionService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async listMine(userId: string): Promise<PaymentMethod[]> {
    const owner = await this.assertOwner(userId);
    return this.paymentMethodRepo.findByOwnerId(owner.id);
  }

  async addCard(
    userId: string,
    dto: SavePaymentMethodDto,
  ): Promise<PaymentMethod> {
    const owner = await this.assertOwner(userId);
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!subscription) {
      throw new NotFoundException(
        'Sua conta não possui uma assinatura. Contate o suporte.',
      );
    }

    // 1. Garante customer no gateway
    let gatewayCustomerId = subscription.gatewayCustomerId;
    if (!gatewayCustomerId) {
      const customer = await this.gateway.createCustomer({
        ownerId: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone || null,
      });
      gatewayCustomerId = customer.id;
    }

    // 2. Vincula o PaymentMethod ao customer no Stripe
    const tokenized = await this.gateway.tokenizeCard({
      customerId: gatewayCustomerId,
      paymentMethodId: dto.paymentMethodId,
      brand: dto.brand,
      last4: dto.last4,
      holderName: dto.holderName,
      expMonth: dto.expMonth,
      expYear: dto.expYear,
    });

    // 3. Marca anteriores como não-default e salva o novo
    await this.paymentMethodRepo.clearDefaultsForOwner(owner.id);
    const saved = await this.paymentMethodRepo.create({
      ownerId: owner.id,
      gatewayProvider: this.gateway.providerId,
      gatewayToken: tokenized.token,
      gatewayCustomerId,
      brand: tokenized.brand,
      last4: tokenized.last4,
      holderName: tokenized.holderName,
      expMonth: tokenized.expMonth,
      expYear: tokenized.expYear,
      isDefault: true,
    });

    // 4. Notifica subscription service
    await this.subscriptionService.onPaymentMethodAdded({
      ownerId: owner.id,
      paymentMethodId: saved.id,
      paymentMethodToken: tokenized.token,
      gatewayCustomerId,
    });

    return saved;
  }

  async removeCard(userId: string, paymentMethodId: string): Promise<void> {
    const owner = await this.assertOwner(userId);
    const pm = await this.paymentMethodRepo.findOne({ id: paymentMethodId });
    if (!pm || pm.ownerId !== owner.id) {
      throw new NotFoundException('Cartão não encontrado');
    }
    await this.paymentMethodRepo.delete(paymentMethodId);

    // Se o PM removido era o default da subscription, limpa o vínculo.
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (subscription?.defaultPaymentMethodId === paymentMethodId) {
      await this.subscriptionRepo.update(subscription.id, {
        defaultPaymentMethodId: null,
      });
    }
  }

  private async assertOwner(userId: string) {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.id !== user.ownerId) {
      throw new ForbiddenException(
        'Apenas o admin da conta pode gerenciar métodos de pagamento',
      );
    }
    return user;
  }
}
