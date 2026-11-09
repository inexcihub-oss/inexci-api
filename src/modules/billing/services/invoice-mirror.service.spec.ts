import { InvoiceMirrorService } from './invoice-mirror.service';
import type { GatewayInvoice } from 'src/shared/payment-gateway/payment-gateway.types';
import type { GatewayInvoiceMirrorRow } from 'src/database/repositories/gateway-invoice.repository';

describe('InvoiceMirrorService', () => {
  const fatura = (overrides: Partial<GatewayInvoice> = {}): GatewayInvoice => ({
    id: 'in_1',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    status: 'paid',
    amountDueCents: 29900,
    amountPaidCents: 29900,
    amountDiscountCents: 0,
    currency: 'BRL',
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-11-01T00:00:00Z'),
    dueDate: null,
    paidAt: new Date('2026-11-01T01:00:00Z'),
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
    couponCode: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  });

  const montar = () => {
    const linhas = new Map<string, GatewayInvoiceMirrorRow>();
    const invoiceRepo = {
      upsertMirror: jest.fn((row: GatewayInvoiceMirrorRow) => {
        linhas.set(row.gatewayInvoiceId, row);
        return Promise.resolve();
      }),
    };
    const subscriptionRepo = {
      findByGatewayCustomerId: jest.fn(),
      findByGatewaySubscriptionId: jest.fn(),
    };
    const service = new InvoiceMirrorService(
      invoiceRepo as never,
      subscriptionRepo as never,
      { providerId: 'stripe' } as never,
    );
    return { service, invoiceRepo, subscriptionRepo, linhas };
  };

  it('resolve o dono pelo cliente da Stripe e grava a linha', async () => {
    const { service, invoiceRepo, subscriptionRepo } = montar();
    subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
      id: 'local-sub',
      ownerId: 'owner-1',
    });

    await service.upsertFromGateway(fatura());

    expect(subscriptionRepo.findByGatewayCustomerId).toHaveBeenCalledWith(
      'cus_1',
    );
    expect(invoiceRepo.upsertMirror).toHaveBeenCalledWith({
      gatewayProvider: 'stripe',
      gatewayInvoiceId: 'in_1',
      ownerId: 'owner-1',
      subscriptionId: 'local-sub',
      gatewayCustomerId: 'cus_1',
      gatewaySubscriptionId: 'sub_1',
      status: 'paid',
      amountDueCents: 29900,
      amountPaidCents: 29900,
      amountDiscountCents: 0,
      currency: 'BRL',
      periodStart: new Date('2026-10-01T00:00:00Z'),
      periodEnd: new Date('2026-11-01T00:00:00Z'),
      dueDate: null,
      paidAt: new Date('2026-11-01T01:00:00Z'),
      invoiceCreatedAt: new Date('2026-11-01T00:00:00Z'),
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
      couponCode: null,
    });
  });

  it('o mesmo evento duas vezes vira uma linha só', async () => {
    const { service, subscriptionRepo, linhas } = montar();
    subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
      id: 'local-sub',
      ownerId: 'owner-1',
    });

    await service.upsertFromGateway(fatura());
    await service.upsertFromGateway(fatura());

    expect(linhas.size).toBe(1);
    expect(linhas.get('in_1')?.amountPaidCents).toBe(29900);
  });

  it('sem cliente conhecido tenta pela assinatura da Stripe', async () => {
    const { service, invoiceRepo, subscriptionRepo } = montar();
    subscriptionRepo.findByGatewayCustomerId.mockResolvedValue(null);
    subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
      id: 'local-sub-2',
      ownerId: 'owner-2',
    });

    await service.upsertFromGateway(fatura());

    expect(invoiceRepo.upsertMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-2',
        subscriptionId: 'local-sub-2',
      }),
    );
  });

  it('fatura de cliente desconhecido é gravada sem dono', async () => {
    const { service, invoiceRepo, subscriptionRepo } = montar();
    subscriptionRepo.findByGatewayCustomerId.mockResolvedValue(null);
    subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

    await service.upsertFromGateway(
      fatura({ customerId: null, subscriptionId: null }),
    );

    expect(subscriptionRepo.findByGatewayCustomerId).not.toHaveBeenCalled();
    expect(invoiceRepo.upsertMirror).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: null, subscriptionId: null }),
    );
  });

  it('moeda e cupom são cortados ao tamanho da coluna', async () => {
    const { service, invoiceRepo, subscriptionRepo } = montar();
    subscriptionRepo.findByGatewayCustomerId.mockResolvedValue(null);
    subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

    await service.upsertFromGateway(
      fatura({ currency: 'BRLX', couponCode: 'x'.repeat(150) }),
    );

    const row = invoiceRepo.upsertMirror.mock.calls[0][0];
    expect(row.currency).toBe('BRL');
    expect(row.couponCode).toHaveLength(100);
  });
});
