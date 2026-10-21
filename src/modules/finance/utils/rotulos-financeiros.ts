import { AppointmentType } from 'src/database/entities/appointment.entity';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';

export const ROTULO_DO_TIPO_DE_CONSULTA: Record<AppointmentType, string> = {
  [AppointmentType.FIRST_VISIT]: 'Primeira consulta',
  [AppointmentType.RETURN]: 'Retorno',
  [AppointmentType.FOLLOW_UP]: 'Acompanhamento',
};

export const ROTULO_DA_FORMA_DE_PAGAMENTO: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Dinheiro',
  [PaymentMethod.PIX]: 'PIX',
  [PaymentMethod.CREDIT_CARD]: 'Cartão de crédito',
  [PaymentMethod.DEBIT_CARD]: 'Cartão de débito',
  [PaymentMethod.BANK_TRANSFER]: 'Transferência bancária',
  [PaymentMethod.BOLETO]: 'Boleto',
  [PaymentMethod.CHECK]: 'Cheque',
  [PaymentMethod.OTHER]: 'Outra forma',
};

export const ROTULO_DO_LANCAMENTO: Record<FinancialEntryKind, string> = {
  [FinancialEntryKind.PAYMENT]: 'Recebimento',
  [FinancialEntryKind.REFUND]: 'Estorno',
  [FinancialEntryKind.WITHDRAWAL]: 'Retirada',
  [FinancialEntryKind.SUPPLY]: 'Suprimento',
  [FinancialEntryKind.SESSION_CLOSING]: 'Fechamento de caixa',
  [FinancialEntryKind.TRANSFER]: 'Transferência',
  [FinancialEntryKind.ADJUSTMENT]: 'Ajuste',
};

export const ROTULO_DA_DIRECAO: Record<FinancialEntryDirection, string> = {
  [FinancialEntryDirection.IN]: 'Entrada',
  [FinancialEntryDirection.OUT]: 'Saída',
};
