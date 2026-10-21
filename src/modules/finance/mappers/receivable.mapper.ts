import { Payment } from 'src/database/entities/payment.entity';
import { ReceivableItem } from 'src/database/entities/receivable-item.entity';
import { Receivable } from 'src/database/entities/receivable.entity';
import { Refund } from 'src/database/entities/refund.entity';
import { ReferenciaDto } from '../dto/finance-common.dto';
import {
  ReceivableDetailDto,
  ReceivableItemDto,
  ReceivableListItemDto,
  ReceivablePaymentDto,
  ReceivableRefundDto,
} from '../dto/receivable.dto';
import { normalizarValor, subtrair } from '../utils/dinheiro';

export function referencia(
  pessoa: { id: string; name: string } | null | undefined,
): ReferenciaDto | null {
  return pessoa ? { id: pessoa.id, name: pessoa.name } : null;
}

export function saldoDevedor(
  cobranca: Pick<Receivable, 'totalAmount' | 'paidAmount'>,
): string {
  const saldo = subtrair(cobranca.totalAmount, cobranca.paidAmount);
  return saldo.startsWith('-') ? '0.00' : saldo;
}

export function paraItemDaLista(
  cobranca: Receivable,
  descricao: string,
): ReceivableListItemDto {
  return {
    id: cobranca.id,
    patient: referencia(cobranca.patient) ?? {
      id: cobranca.patientId,
      name: '',
    },
    appointmentId: cobranca.appointmentId ?? null,
    referenceDate: cobranca.referenceDate,
    dueDate: cobranca.dueDate ?? null,
    totalAmount: normalizarValor(cobranca.totalAmount),
    paidAmount: normalizarValor(cobranca.paidAmount),
    balance: saldoDevedor(cobranca),
    status: cobranca.status,
    description: descricao,
    createdAt: cobranca.createdAt,
  };
}

function paraItem(item: ReceivableItem): ReceivableItemDto {
  return {
    id: item.id,
    description: item.description,
    executedBy: referencia(item.executedBy),
    executedAt: item.executedAt ?? null,
    appointmentId: item.appointmentId ?? null,
    quantity: item.quantity,
    unitAmount: normalizarValor(item.unitAmount),
    discount: normalizarValor(item.discount),
    surcharge: normalizarValor(item.surcharge),
    total: normalizarValor(item.total),
    cancelledAt: item.cancelledAt ?? null,
  };
}

function paraEstorno(estorno: Refund): ReceivableRefundDto {
  return {
    id: estorno.id,
    amount: normalizarValor(estorno.amount),
    reason: estorno.reason,
    notes: estorno.notes ?? null,
    createdAt: estorno.createdAt,
    refundedBy: referencia(estorno.refundedBy),
  };
}

function paraPagamento(pagamento: Payment): ReceivablePaymentDto {
  return {
    id: pagamento.id,
    method: pagamento.method,
    amount: normalizarValor(pagamento.amount),
    refundedAmount: normalizarValor(pagamento.refundedAmount),
    paidAt: pagamento.paidAt,
    account: referencia(pagamento.account),
    cashSessionId: pagamento.cashSessionId ?? null,
    receivedBy: referencia(pagamento.receivedBy),
    cardBrand: pagamento.cardBrand ?? null,
    installments: pagamento.installments,
    nsu: pagamento.nsu ?? null,
    authorizationCode: pagamento.authorizationCode ?? null,
    notes: pagamento.notes ?? null,
    refunds: (pagamento.refunds ?? []).map(paraEstorno),
  };
}

export function paraDetalhe(cobranca: Receivable): ReceivableDetailDto {
  const itens = cobranca.items ?? [];
  const descricao = itens
    .filter((item) => !item.cancelledAt)
    .map((item) => item.description)
    .join(', ');
  return {
    ...paraItemDaLista(cobranca, descricao),
    notes: cobranca.notes ?? null,
    cancelledAt: cobranca.cancelledAt ?? null,
    cancelReason: cobranca.cancelReason ?? null,
    cancelledBy: referencia(cobranca.cancelledBy),
    createdBy: referencia(cobranca.createdBy),
    items: itens.map(paraItem),
    payments: (cobranca.payments ?? []).map(paraPagamento),
  };
}
