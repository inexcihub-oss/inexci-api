import { Inject, Injectable } from '@nestjs/common';

import { GatewayInvoiceRepository } from 'src/database/repositories/gateway-invoice.repository';
import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import type { Subscription } from 'src/database/entities/subscription.entity';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import type { GatewayInvoice } from 'src/shared/payment-gateway/payment-gateway.types';

@Injectable()
export class InvoiceMirrorService {
  constructor(
    private readonly invoiceRepo: GatewayInvoiceRepository,
    private readonly subscriptionRepo: SubscriptionRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async upsertFromGateway(invoice: GatewayInvoice): Promise<void> {
    const local = await this.resolveLocal(invoice);
    await this.invoiceRepo.upsertMirror({
      gatewayProvider: this.gateway.providerId,
      gatewayInvoiceId: invoice.id,
      ownerId: local?.ownerId ?? null,
      subscriptionId: local?.id ?? null,
      gatewayCustomerId: invoice.customerId,
      gatewaySubscriptionId: invoice.subscriptionId,
      status: invoice.status,
      amountDueCents: invoice.amountDueCents,
      amountPaidCents: invoice.amountPaidCents,
      amountDiscountCents: invoice.amountDiscountCents,
      currency: invoice.currency.slice(0, 3),
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      invoiceCreatedAt: invoice.createdAt,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      couponCode: invoice.couponCode ? invoice.couponCode.slice(0, 100) : null,
    });
  }

  private async resolveLocal(
    invoice: GatewayInvoice,
  ): Promise<Pick<Subscription, 'id' | 'ownerId'> | null> {
    if (invoice.customerId) {
      const byCustomer = await this.subscriptionRepo.findByGatewayCustomerId(
        invoice.customerId,
      );
      if (byCustomer) return byCustomer;
    }
    if (invoice.subscriptionId) {
      return this.subscriptionRepo.findByGatewaySubscriptionId(
        invoice.subscriptionId,
      );
    }
    return null;
  }
}
