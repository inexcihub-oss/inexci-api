import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';

export const CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA = new Set(['5', '11', '12']);

export const PROCEDIMENTOS_DE_PRIMEIRA_VEZ = new Set(['28']);

export const PROCEDIMENTOS_DE_RETORNO = new Set(['30', '24']);

export const PROFISSIONAIS_DE_ACOMPANHAMENTO = new Set(['9']);

export const MODELOS_COM_CONDUTA_NO_TEXTO = new Set(['7']);

export const FORMAS_DE_PAGAMENTO_DO_CLIENTE: Record<
  string,
  { metodo: PaymentMethod; nota: string }
> = {
  '12': { metodo: PaymentMethod.OTHER, nota: 'Forma Feegow 12' },
};

export const CONTAS_FINANCEIRAS_POR_NOME: Record<string, FinancialAccountType> =
  {
    'caixa fisico': FinancialAccountType.CASH_DRAWER,
    stone: FinancialAccountType.BANK,
    'stone - credito': FinancialAccountType.CARD_CREDIT,
    'stone - debito': FinancialAccountType.CARD_DEBIT,
    cora: FinancialAccountType.BANK,
  };

export const DEMONSTRACAO_FINANCEIRA_ATE = '2023-12-31';
