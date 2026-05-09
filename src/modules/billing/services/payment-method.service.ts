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
 * Servi\u00e7o de m\u00e9todos de pagamento.
 *
 * Fluxo de cadastro de cart\u00e3o:
 * 1. Garante que existe um customer no gateway para o owner (cria se n\u00e3o
 *    existir, reaproveita se j\u00e1 existir em outro PM).
 * 2. Tokeniza o cart\u00e3o no gateway.
 * 3. Salva o PaymentMethod local (token + metadados de exibi\u00e7\u00e3o).
 * 4. Aciona `SubscriptionService.onPaymentMethodAdded` para criar/atualizar
 *    a subscription no gateway (encerrando trial ou suspens\u00e3o).
 *
 * IMPORTANTE: dados sens\u00edveis (n\u00famero/CVV) JAMAIS s\u00e3o persistidos.
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
    remoteIp: string,
  ): Promise<PaymentMethod> {
    const owner = await this.assertOwner(userId);
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!subscription) {
      throw new NotFoundException(
        'Sua conta n\u00e3o possui uma assinatura. Contate o suporte.',
      );
    }

    // 1. Garante customer no gateway
    let gatewayCustomerId = subscription.gatewayCustomerId;
    if (!gatewayCustomerId) {
      const customer = await this.gateway.createCustomer({
        ownerId: owner.id,
        name: dto.holderInfoName || owner.name,
        email: dto.holderInfoEmail || owner.email,
        cpfCnpj: dto.holderInfoCpfCnpj,
        phone: dto.holderInfoPhone || owner.phone || null,
      });
      gatewayCustomerId = customer.id;
    }

    // 2. Tokeniza
    const tokenized = await this.gateway.tokenizeCard({
      customerId: gatewayCustomerId,
      number: dto.number.replace(/\s/g, ''),
      holderName: dto.holderName,
      expiryMonth: dto.expiryMonth,
      expiryYear: dto.expiryYear,
      ccv: dto.ccv,
      holderInfo: {
        name: dto.holderInfoName,
        email: dto.holderInfoEmail,
        cpfCnpj: dto.holderInfoCpfCnpj,
        postalCode: dto.holderInfoPostalCode,
        addressNumber: dto.holderInfoAddressNumber,
        addressComplement: dto.holderInfoAddressComplement || null,
        phone: dto.holderInfoPhone || null,
        mobilePhone: dto.holderInfoPhone || null,
      },
      remoteIp,
    });

    // 3. Marca anteriores como n\u00e3o-default e salva o novo
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
      throw new NotFoundException('Cart\u00e3o n\u00e3o encontrado');
    }
    await this.paymentMethodRepo.delete(paymentMethodId);

    // Se o PM removido era o default da subscription, limpa o v\u00ednculo.
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (subscription?.defaultPaymentMethodId === paymentMethodId) {
      await this.subscriptionRepo.update(subscription.id, {
        defaultPaymentMethodId: null,
      });
    }
  }

  private async assertOwner(userId: string) {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usu\u00e1rio n\u00e3o encontrado');
    if (user.id !== user.ownerId) {
      throw new ForbiddenException(
        'Apenas o admin da conta pode gerenciar m\u00e9todos de pagamento',
      );
    }
    return user;
  }
}
