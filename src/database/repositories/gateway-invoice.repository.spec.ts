import { GatewayInvoiceRepository } from './gateway-invoice.repository';

describe('GatewayInvoiceRepository', () => {
  const linha = {
    gatewayProvider: 'stripe',
    gatewayInvoiceId: 'in_1',
    ownerId: 'owner-1',
    subscriptionId: 'sub-local-1',
    gatewayCustomerId: 'cus_1',
    gatewaySubscriptionId: 'sub_1',
    status: 'paid' as const,
    amountDueCents: 29900,
    amountPaidCents: 23920,
    amountDiscountCents: 5980,
    currency: 'BRL',
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-11-01T00:00:00Z'),
    dueDate: null,
    paidAt: new Date('2026-11-01T01:00:00Z'),
    invoiceCreatedAt: new Date('2026-11-01T00:00:00Z'),
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
    couponCode: 'BEMVINDO',
  };

  const montar = () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = new GatewayInvoiceRepository({ query } as never);
    return { repo, query };
  };

  it('faz upsert por gateway_invoice_id, sem duplicar', async () => {
    const { repo, query } = montar();

    await repo.upsertMirror(linha);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO "gateway_invoices"');
    expect(sql).toContain('ON CONFLICT ("gateway_invoice_id") DO UPDATE');
    expect(params).toEqual([
      'stripe',
      'in_1',
      'owner-1',
      'sub-local-1',
      'cus_1',
      'sub_1',
      'paid',
      29900,
      23920,
      5980,
      'BRL',
      linha.periodStart,
      linha.periodEnd,
      null,
      linha.paidAt,
      linha.invoiceCreatedAt,
      'https://invoice.stripe.com/i/in_1',
      'BEMVINDO',
    ]);
  });

  it('não rebaixa o status: evento atrasado de "open" não desfaz um "paid"', async () => {
    const { repo, query } = montar();

    await repo.upsertMirror(linha);

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toMatch(
      /WHERE \(CASE "gateway_invoices"\."status" .*\) <= \(CASE EXCLUDED\."status" .*\)/s,
    );
    expect(sql).toContain("WHEN 'paid' THEN 3");
    expect(sql).toContain("WHEN 'void' THEN 3");
    expect(sql).toContain("WHEN 'uncollectible' THEN 2");
    expect(sql).toContain("WHEN 'open' THEN 1");
  });

  it('dono, cupom e link não são apagados por um evento sem esses dados', async () => {
    const { repo, query } = montar();

    await repo.upsertMirror(linha);

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain(
      '"owner_id" = COALESCE(EXCLUDED."owner_id", "gateway_invoices"."owner_id")',
    );
    expect(sql).toContain(
      '"coupon_code" = COALESCE(EXCLUDED."coupon_code", "gateway_invoices"."coupon_code")',
    );
    expect(sql).toContain(
      '"hosted_invoice_url" = COALESCE(EXCLUDED."hosted_invoice_url", "gateway_invoices"."hosted_invoice_url")',
    );
    expect(sql).toContain('"updated_at" = now()');
  });
});

describe('GatewayInvoiceRepository.listCouponRedemptions', () => {
  it('consulta por código sem diferenciar maiúsculas, agrupa por conta e converte o percentual', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        ownerId: 'o-1',
        ownerName: 'Clínica A',
        ownerEmail: 'a@clinica.com',
        firstInvoiceAt: new Date('2026-10-01T00:00:00Z'),
        firstInvoiceId: 'in_1',
        invoicesCount: 2,
        totalDiscountCents: 11960,
        currentDiscountPercentOff: '20.00',
        currentDiscountAmountOffCents: null,
        currentDiscountDuration: 'repeating',
        currentDiscountEndsAt: null,
      },
      {
        ownerId: 'o-2',
        ownerName: 'Clínica B',
        ownerEmail: 'b@clinica.com',
        firstInvoiceAt: new Date('2026-09-01T00:00:00Z'),
        firstInvoiceId: 'in_9',
        invoicesCount: 1,
        totalDiscountCents: 1000,
        currentDiscountPercentOff: null,
        currentDiscountAmountOffCents: 1000,
        currentDiscountDuration: 'once',
        currentDiscountEndsAt: null,
      },
    ]);
    const repo = new GatewayInvoiceRepository({ query } as never);

    const rows = await repo.listCouponRedemptions('MAIO20');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('lower(gi.coupon_code) = lower($1)');
    expect(sql).toContain('GROUP BY u.owner_id');
    expect(params).toEqual(['MAIO20']);
    expect(rows[0].currentDiscountPercentOff).toBe(20);
    expect(rows[1].currentDiscountPercentOff).toBeNull();
    expect(rows[1].currentDiscountAmountOffCents).toBe(1000);
  });
});
