import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import {
  bandeiraDoCartao,
  ehDemonstracao,
  formaDePagamento,
  horaDoDhup,
  listaDeIds,
  motivoDoEstorno,
  parcelasDoCartao,
  tipoDaConta,
  tipoDaTransferencia,
} from './finance.rules';

describe('formaDePagamento', () => {
  it.each([
    ['1', PaymentMethod.CASH],
    ['2', PaymentMethod.CHECK],
    ['3', PaymentMethod.BANK_TRANSFER],
    ['4', PaymentMethod.BOLETO],
    ['5', PaymentMethod.BANK_TRANSFER],
    ['6', PaymentMethod.BANK_TRANSFER],
    ['7', PaymentMethod.BANK_TRANSFER],
    ['8', PaymentMethod.CREDIT_CARD],
    ['9', PaymentMethod.DEBIT_CARD],
    ['10', PaymentMethod.CREDIT_CARD],
    ['15', PaymentMethod.PIX],
  ])('forma %s → %s, sem nota', (id, metodo) => {
    expect(formaDePagamento(id)).toEqual({
      metodo,
      nota: null,
      conhecida: true,
    });
  });

  it('forma 12 do cliente vira "outro" com a nota "Forma Feegow 12"', () => {
    expect(formaDePagamento('12')).toEqual({
      metodo: PaymentMethod.OTHER,
      nota: 'Forma Feegow 12',
      conhecida: true,
    });
  });

  it('forma desconhecida vira "outro" e é marcada para aviso', () => {
    expect(formaDePagamento('77')).toEqual({
      metodo: PaymentMethod.OTHER,
      nota: 'Forma Feegow 77',
      conhecida: false,
    });
  });
});

describe('tipoDaConta', () => {
  it('nome do cliente vence o tipo do Feegow, sem diferenciar acento', () => {
    expect(tipoDaConta('Stone - Crédito', '2')).toBe(
      FinancialAccountType.CARD_CREDIT,
    );
    expect(tipoDaConta('CAIXA FISICO', '2')).toBe(
      FinancialAccountType.CASH_DRAWER,
    );
    expect(tipoDaConta('Cora', '1')).toBe(FinancialAccountType.BANK);
  });

  it('sem nome conhecido usa o tipo do Feegow; tipo desconhecido vira "outra"', () => {
    expect(tipoDaConta('Banco Qualquer', '2')).toBe(FinancialAccountType.BANK);
    expect(tipoDaConta('Maquininha X', '4')).toBe(
      FinancialAccountType.CARD_DEBIT,
    );
    expect(tipoDaConta('Cartão da clínica', '5')).toBe(
      FinancialAccountType.OTHER,
    );
  });
});

describe('motivoDoEstorno', () => {
  it('casa o texto do Feegow com o enum', () => {
    expect(motivoDoEstorno('Erro na forma de pagamento')).toEqual({
      motivo: RefundReason.WRONG_PAYMENT_METHOD,
      conhecido: true,
    });
    expect(
      motivoDoEstorno('Troca de procedimento, exame ou especialidade'),
    ).toEqual({ motivo: RefundReason.SERVICE_CHANGE, conhecido: true });
    expect(motivoDoEstorno('Outros').motivo).toBe(RefundReason.OTHER);
  });

  it('sem correspondência vira "outro"', () => {
    expect(motivoDoEstorno('Motivo inventado')).toEqual({
      motivo: RefundReason.OTHER,
      conhecido: false,
    });
    expect(motivoDoEstorno(null).motivo).toBe(RefundReason.OTHER);
  });
});

describe('tipoDaTransferencia', () => {
  const doCaixa = {
    associacao_conta_id_debito: '1',
    associacao_conta_id_credito: '7',
  };

  it('fechamento e retirada só saindo de caixa', () => {
    expect(
      tipoDaTransferencia({
        ...doCaixa,
        descricao: 'Fechamento Cx - Dinheiro',
      }),
    ).toBe('fechamento');
    expect(tipoDaTransferencia({ ...doCaixa, descricao: 'RETIRADA' })).toBe(
      'retirada',
    );
    expect(
      tipoDaTransferencia({
        associacao_conta_id_debito: '1',
        associacao_conta_id_credito: '1',
        descricao: 'Fechamento Cx - Dinheiro',
      }),
    ).toBe('avulsa');
  });

  it('movimento com a conta do paciente em qualquer lado', () => {
    expect(
      tipoDaTransferencia({
        associacao_conta_id_debito: '0',
        associacao_conta_id_credito: '3',
        descricao: 'Cancelamento de serviço (1)',
      }),
    ).toBe('paciente');
  });

  it('o resto é avulso', () => {
    expect(
      tipoDaTransferencia({ ...doCaixa, descricao: 'Pagamento de material' }),
    ).toBe('avulsa');
  });
});

describe('utilitários', () => {
  it('demonstração = até o fim de 2023', () => {
    expect(ehDemonstracao('2023-08-16')).toBe(true);
    expect(ehDemonstracao('2023-12-31 23:00:00')).toBe(true);
    expect(ehDemonstracao('2025-05-23')).toBe(false);
    expect(ehDemonstracao(null)).toBe(false);
  });

  it('hora do dhup', () => {
    expect(horaDoDhup('2025-06-03 14:15:16')).toBe('14:15:16');
    expect(horaDoDhup(null)).toBeNull();
  });

  it('bandeira 0 é nula; parcelas inválidas viram 1', () => {
    const nomes = new Map([['2', 'Mastercard']]);
    expect(bandeiraDoCartao('0', nomes)).toBeNull();
    expect(bandeiraDoCartao('2', nomes)).toBe('Mastercard');
    expect(bandeiraDoCartao('99', nomes)).toBeNull();
    expect(parcelasDoCartao('4')).toBe(4);
    expect(parcelasDoCartao('0')).toBe(1);
    expect(parcelasDoCartao(null)).toBe(1);
  });

  it('lista de ids do Feegow', () => {
    expect(listaDeIds('|8|, |9|')).toEqual(['8', '9']);
    expect(listaDeIds('|ALL|')).toEqual(['ALL']);
    expect(listaDeIds(null)).toEqual([]);
  });
});
