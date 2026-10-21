import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { ValorMonetario, paraCentavos } from './dinheiro';

export interface DadosDoStatusDaCobranca {
  totalAmount: ValorMonetario;
  paidAmount: ValorMonetario;
  cancelledAt?: Date | string | null;
}

export function statusDaCobranca({
  totalAmount,
  paidAmount,
  cancelledAt,
}: DadosDoStatusDaCobranca): ReceivableStatus {
  if (cancelledAt) return ReceivableStatus.CANCELLED;

  const total = paraCentavos(totalAmount);
  const pago = paraCentavos(paidAmount);

  if (pago >= total) return ReceivableStatus.PAID;
  if (pago > 0) return ReceivableStatus.PARTIAL;
  return ReceivableStatus.OPEN;
}
