import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import {
  REFUND_REASON_LABELS,
  RefundReason,
} from 'src/database/entities/refund.entity';
import { normalizarData } from '../../core/normalizers';
import { chaveDeNome } from '../context';
import {
  CONTAS_FINANCEIRAS_POR_NOME,
  DEMONSTRACAO_FINANCEIRA_ATE,
  FORMAS_DE_PAGAMENTO_DO_CLIENTE,
} from '../regras-do-cliente';

export const ASSOCIACAO_CONTA_CORRENTE = '1';
export const ASSOCIACAO_PACIENTE = '3';
export const ASSOCIACAO_CAIXA = '7';

const FORMAS_DO_FEEGOW: Record<string, PaymentMethod> = {
  '1': PaymentMethod.CASH,
  '2': PaymentMethod.CHECK,
  '3': PaymentMethod.BANK_TRANSFER,
  '4': PaymentMethod.BOLETO,
  '5': PaymentMethod.BANK_TRANSFER,
  '6': PaymentMethod.BANK_TRANSFER,
  '7': PaymentMethod.BANK_TRANSFER,
  '8': PaymentMethod.CREDIT_CARD,
  '9': PaymentMethod.DEBIT_CARD,
  '10': PaymentMethod.CREDIT_CARD,
  '15': PaymentMethod.PIX,
};

export interface FormaDePagamento {
  metodo: PaymentMethod;
  nota: string | null;
  conhecida: boolean;
}

export function formaDePagamento(
  formaId: string | null | undefined,
): FormaDePagamento {
  const id = (formaId ?? '').trim();
  const doCliente = FORMAS_DE_PAGAMENTO_DO_CLIENTE[id];
  if (doCliente) {
    return { metodo: doCliente.metodo, nota: doCliente.nota, conhecida: true };
  }
  const padrao = FORMAS_DO_FEEGOW[id];
  if (padrao) return { metodo: padrao, nota: null, conhecida: true };
  return {
    metodo: PaymentMethod.OTHER,
    nota: `Forma Feegow ${id || 'sem código'}`,
    conhecida: false,
  };
}

const TIPOS_DE_CONTA_DO_FEEGOW: Record<string, FinancialAccountType> = {
  '1': FinancialAccountType.CASH_DRAWER,
  '2': FinancialAccountType.BANK,
  '3': FinancialAccountType.CARD_CREDIT,
  '4': FinancialAccountType.CARD_DEBIT,
};

export function tipoDaConta(
  nome: string | null | undefined,
  tipoFeegow: string | null | undefined,
): FinancialAccountType {
  return (
    CONTAS_FINANCEIRAS_POR_NOME[chaveDeNome(nome ?? '')] ??
    TIPOS_DE_CONTA_DO_FEEGOW[(tipoFeegow ?? '').trim()] ??
    FinancialAccountType.OTHER
  );
}

const MOTIVOS_POR_NOME = new Map<string, RefundReason>([
  ...Object.entries(REFUND_REASON_LABELS).map(
    ([motivo, rotulo]): [string, RefundReason] => [
      chaveDeNome(rotulo),
      motivo as RefundReason,
    ],
  ),
  ['outros', RefundReason.OTHER],
]);

export function motivoDoEstorno(texto: string | null | undefined): {
  motivo: RefundReason;
  conhecido: boolean;
} {
  const motivo = MOTIVOS_POR_NOME.get(chaveDeNome(texto ?? ''));
  return motivo
    ? { motivo, conhecido: true }
    : { motivo: RefundReason.OTHER, conhecido: false };
}

export type TipoDeTransferencia =
  | 'fechamento'
  | 'retirada'
  | 'paciente'
  | 'avulsa';

export function tipoDaTransferencia(linha: {
  descricao?: string | null;
  associacao_conta_id_debito?: string | null;
  associacao_conta_id_credito?: string | null;
}): TipoDeTransferencia {
  if (
    linha.associacao_conta_id_debito === ASSOCIACAO_PACIENTE ||
    linha.associacao_conta_id_credito === ASSOCIACAO_PACIENTE
  ) {
    return 'paciente';
  }
  const descricao = chaveDeNome(linha.descricao ?? '');
  const doCaixa = linha.associacao_conta_id_credito === ASSOCIACAO_CAIXA;
  if (doCaixa && /^fechamento\s+cx\b/.test(descricao)) return 'fechamento';
  if (doCaixa && /^retirada\b/.test(descricao)) return 'retirada';
  return 'avulsa';
}

export function ehDemonstracao(data: string | null | undefined): boolean {
  const d = normalizarData(data);
  return !!d && d <= DEMONSTRACAO_FINANCEIRA_ATE;
}

export function horaDoDhup(dhup: string | null | undefined): string | null {
  const m = /\b(\d{2}:\d{2}:\d{2})\b/.exec(dhup ?? '');
  return m ? m[1] : null;
}

export function bandeiraDoCartao(
  id: string | null | undefined,
  nomes: Map<string, string>,
): string | null {
  const chave = (id ?? '').trim();
  if (!chave || chave === '0') return null;
  const nome = (nomes.get(chave) ?? '').trim();
  return nome ? nome.slice(0, 30) : null;
}

export function parcelasDoCartao(valor: string | null | undefined): number {
  const n = Number((valor ?? '').trim());
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 99) : 1;
}

export function listaDeIds(valor: string | null | undefined): string[] {
  return [...(valor ?? '').matchAll(/\|([^|]*)\|/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}
