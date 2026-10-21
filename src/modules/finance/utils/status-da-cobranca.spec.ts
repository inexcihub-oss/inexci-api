import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { statusDaCobranca } from './status-da-cobranca';

describe('statusDaCobranca', () => {
  it.each([
    ['100.00', '0.00', null, ReceivableStatus.OPEN],
    ['100.00', '0', null, ReceivableStatus.OPEN],
    ['100.00', '0.01', null, ReceivableStatus.PARTIAL],
    ['100.00', '99.99', null, ReceivableStatus.PARTIAL],
    ['100.00', '100.00', null, ReceivableStatus.PAID],
    ['100.00', '150.00', null, ReceivableStatus.PAID],
    ['0.00', '0.00', null, ReceivableStatus.PAID],
    ['0', null, null, ReceivableStatus.PAID],
    ['0.04', '0.00', null, ReceivableStatus.OPEN],
    ['100.00', '100.00', new Date(), ReceivableStatus.CANCELLED],
    ['100.00', '0.00', '2026-10-20T10:00:00Z', ReceivableStatus.CANCELLED],
    ['0.00', '0.00', new Date(), ReceivableStatus.CANCELLED],
  ])(
    'total %p pago %p cancelada %p → %p',
    (totalAmount, paidAmount, cancelledAt, esperado) => {
      expect(statusDaCobranca({ totalAmount, paidAmount, cancelledAt })).toBe(
        esperado,
      );
    },
  );

  it('compara em centavos, sem ponto flutuante', () => {
    expect(
      statusDaCobranca({ totalAmount: '0.30', paidAmount: 0.1 + 0.2 }),
    ).toBe(ReceivableStatus.PAID);
  });
});
