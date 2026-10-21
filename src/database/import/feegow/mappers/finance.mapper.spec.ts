import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import { totalDoItem } from 'src/modules/finance/utils/dinheiro';
import { ContextoImportacao } from '../context';
import {
  exportFinanceiro,
  ledgerDaCarga,
  tabelasFinanceiras,
} from '../testing/financeiro-sintetico';
import { contextoDeTeste, OWNER } from '../testing/export-sintetico';
import {
  DadosFinanceirosDoBanco,
  lerFinanceiro,
  LEDGER_CAIXA,
  LEDGER_COBRANCA,
  LEDGER_CONTA_FINANCEIRA,
  LEDGER_PAGAMENTO,
  NOTA_FECHADO_NA_MIGRACAO,
  planejarFinanceiroDoExport,
  resumoDoExport,
} from './finance.mapper';

function planejar(
  sobrescrever: Parameters<typeof exportFinanceiro>[0] = {},
  parcial: Partial<ContextoImportacao> = {},
) {
  const ctx = contextoDeTeste({ ledger: ledgerDaCarga(), ...parcial });
  const exp = exportFinanceiro(sobrescrever);
  return { ctx, exp, plano: planejarFinanceiroDoExport(exp, ctx) };
}

const cobrancaDa = (r: ReturnType<typeof planejar>, contaFeegow: string) => {
  const id = r.ctx.ledger.resolver(LEDGER_COBRANCA, contaFeegow);
  return r.plano.cobrancas.find((c) => c.id === id);
};

const pagamentoDo = (r: ReturnType<typeof planejar>, mov: string) => {
  const id = r.ctx.ledger.resolver(LEDGER_PAGAMENTO, mov);
  return r.plano.pagamentos.find((p) => p.id === id)!;
};

const caixaDo = (r: ReturnType<typeof planejar>, caixa: string) => {
  const id = r.ctx.ledger.resolver(LEDGER_CAIXA, caixa);
  return r.plano.caixas.find((c) => c.id === id)!;
};

describe('planejarFinanceiro — contas e formas', () => {
  it('cria as contas ativas pelo nome e deixa as de exemplo (-1) de fora (D5)', () => {
    const r = planejar();
    expect(r.plano.contas.map((c) => [c.name, c.type])).toEqual([
      ['Caixa Físico', FinancialAccountType.CASH_DRAWER],
      ['Stone', FinancialAccountType.BANK],
      ['Stone - Crédito', FinancialAccountType.CARD_CREDIT],
      ['Stone - Débito', FinancialAccountType.CARD_DEBIT],
    ]);
    expect(r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '1')).toBeNull();
    expect(r.ctx.relatorio.extras.demonstracao).toEqual(
      expect.arrayContaining([{ tabela: 'contas_correntes', id: '1' }]),
    );
  });

  it('reaproveita a conta já cadastrada na tela, casando por nome', () => {
    const financeiro: DadosFinanceirosDoBanco = {
      contasPorNome: new Map([
        [
          'stone',
          { id: 'stone-db', type: FinancialAccountType.BANK, active: true },
        ],
      ]),
      formas: new Map(),
      pacientesPorCpf: new Map(),
      consultasComCobranca: new Set(),
    };
    const r = planejar({}, { financeiro });
    expect(r.plano.contas.map((c) => c.name)).not.toContain('Stone');
    expect(r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '7')).toBe(
      'stone-db',
    );
    expect(pagamentoDo(r, 'p201').accountId).toBe('stone-db');
  });

  it('formas de recebimento viram configuração, crédito com parcelas e conta padrão', () => {
    const r = planejar();
    const conta = (id: string) =>
      r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, id);
    expect(
      r.plano.formasNovas.map((f) => [
        f.method,
        f.defaultAccountId,
        f.maxInstallments,
      ]),
    ).toEqual([
      [PaymentMethod.CREDIT_CARD, conta('8'), 12],
      [PaymentMethod.DEBIT_CARD, conta('9'), 1],
      [PaymentMethod.CASH, conta('6'), 1],
      [PaymentMethod.PIX, conta('7'), 1],
    ]);
  });

  it('só preenche o que a tela ainda não configurou', () => {
    const financeiro: DadosFinanceirosDoBanco = {
      contasPorNome: new Map(),
      formas: new Map([
        [
          PaymentMethod.CREDIT_CARD,
          { id: 'cfg-cc', defaultAccountId: null, maxInstallments: 1 },
        ],
        [
          PaymentMethod.PIX,
          { id: 'cfg-pix', defaultAccountId: 'outra', maxInstallments: 1 },
        ],
      ]),
      pacientesPorCpf: new Map(),
      consultasComCobranca: new Set(),
    };
    const r = planejar({}, { financeiro });
    expect(r.plano.formasNovas.map((f) => f.method)).toEqual([
      PaymentMethod.DEBIT_CARD,
      PaymentMethod.CASH,
    ]);
    expect(r.plano.formasAtualizadas).toEqual([
      {
        id: 'cfg-cc',
        method: PaymentMethod.CREDIT_CARD,
        defaultAccountId: r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '8'),
        maxInstallments: 12,
      },
    ]);
  });
});

describe('planejarFinanceiro — cobranças e pagamentos', () => {
  it('pagamento dividido em duas formas quita a cobrança', () => {
    const r = planejar();
    const c = cobrancaDa(r, '100')!;
    expect(c).toMatchObject({
      ownerId: OWNER,
      patientId: 'pac-10',
      appointmentId: 'cons-1',
      referenceDate: '2025-06-01',
      dueDate: '2025-06-01',
      totalAmount: '300.00',
      paidAmount: '300.00',
      status: ReceivableStatus.PAID,
      createdById: 'func-2',
    });
    const dinheiro = pagamentoDo(r, 'p200');
    const pix = pagamentoDo(r, 'p201');
    expect(dinheiro).toMatchObject({
      method: PaymentMethod.CASH,
      amount: '100.00',
      cashSessionId: caixaDo(r, '1').id,
      accountId: r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '6'),
      receivedById: 'func-2',
    });
    expect(pix).toMatchObject({
      method: PaymentMethod.PIX,
      accountId: r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '7'),
      cashSessionId: caixaDo(r, '1').id,
    });
    const entradas = r.plano.lancamentos.filter(
      (l) => l.paymentId === dinheiro.id || l.paymentId === pix.id,
    );
    expect(
      entradas.map((l) => [
        l.kind,
        l.direction,
        !!l.cashSessionId,
        !!l.accountId,
      ]),
    ).toEqual([
      [FinancialEntryKind.PAYMENT, FinancialEntryDirection.IN, true, false],
      [FinancialEntryKind.PAYMENT, FinancialEntryDirection.IN, false, true],
    ]);
  });

  it('item usa o nome do procedimento quando a descrição é vazia e guarda executante e consulta', () => {
    const r = planejar();
    const c = cobrancaDa(r, '100')!;
    expect(r.plano.itens.find((i) => i.receivableId === c.id)).toMatchObject({
      description: 'Consulta exemplo',
      executedById: 'prof-1',
      executedAt: '2025-06-01',
      appointmentId: 'cons-1',
      unitAmount: '300.00',
      quantity: 1,
    });
    const c108 = cobrancaDa(r, '108')!;
    expect(
      r.plano.itens.find((i) => i.receivableId === c108.id)!.description,
    ).toBe('Retorno combinado');
  });

  it('desconto ou acréscimo negativo troca de campo, mantém o total e vai ao relatório', () => {
    const base = tabelasFinanceiras();
    const r = planejar({
      conta_itens: base.conta_itens.map((linha) =>
        linha.id === '1090'
          ? { ...linha, desconto: '-10.00', acrescimo: '-5.00' }
          : linha,
      ),
    });
    const c = cobrancaDa(r, '109')!;
    const itemDaCobranca = r.plano.itens.find((i) => i.receivableId === c.id)!;
    expect(itemDaCobranca).toMatchObject({
      unitAmount: '80.00',
      discount: '5.00',
      surcharge: '10.00',
      total: '85.00',
    });
    expect(c.totalAmount).toBe('85.00');
    expect(
      r.ctx.relatorio.avisos.some(
        (a) => a.idOrigem === '1090' && a.aviso.includes('sinal foi trocado'),
      ),
    ).toBe(true);
  });

  it('todo item planejado leva o total gravado', () => {
    const r = planejar();
    r.plano.itens.forEach((i) =>
      expect(i.total).toBe(
        totalDoItem({
          unitAmount: i.unitAmount,
          quantity: i.quantity,
          discount: i.discount,
          surcharge: i.surcharge,
        }),
      ),
    );
  });

  it('pagamento parcial em cartão de crédito com parcelas, bandeira e NSU; hora do dhup', () => {
    const r = planejar();
    expect(cobrancaDa(r, '101')).toMatchObject({
      totalAmount: '400.00',
      paidAmount: '150.00',
      status: ReceivableStatus.PARTIAL,
    });
    const p = pagamentoDo(r, 'p202');
    expect(p).toMatchObject({
      installments: 3,
      cardBrand: 'Mastercard',
      nsu: 'NSU1',
      authorizationCode: null,
      cashSessionId: null,
    });
    expect(p.paidAt.toISOString()).toBe('2025-06-02T17:15:16.000Z');
  });

  it('total zero entra paga (D9); sem pagamento entra aberta (D3) e vai para o relatório', () => {
    const r = planejar();
    expect(cobrancaDa(r, '102')).toMatchObject({
      totalAmount: '0.00',
      status: ReceivableStatus.PAID,
    });
    const aberta = cobrancaDa(r, '103')!;
    expect(aberta).toMatchObject({
      status: ReceivableStatus.OPEN,
      appointmentId: null,
    });
    expect(r.ctx.relatorio.extras.cobrancasEmAberto).toEqual([
      expect.objectContaining({
        conta: '101',
        status: ReceivableStatus.PARTIAL,
        saldo: '250.00',
      }),
      expect.objectContaining({
        conta: '103',
        status: ReceivableStatus.OPEN,
        total: '250.00',
        saldo: '250.00',
        dataDeReferencia: '2025-06-03',
      }),
    ]);
    expect(
      r.ctx.relatorio.avisos.some(
        (a) =>
          a.idOrigem === '1030' &&
          a.aviso.startsWith('consulta fora do ledger'),
      ),
    ).toBe(true);
  });

  it('forma 12 entra como "outro" com nota e aparece no relatório', () => {
    const r = planejar();
    expect(pagamentoDo(r, 'p205')).toMatchObject({
      method: PaymentMethod.OTHER,
      notes: 'Forma Feegow 12',
    });
    expect(r.ctx.relatorio.extras.pagamentosComFormaDoCliente).toEqual([
      expect.objectContaining({
        movimentacao: 'p205',
        forma: '12',
        valor: '200.00',
      }),
    ]);
  });

  it('estorno sai de onde o pagamento entrou e zera o recebido da cobrança cancelada', () => {
    const r = planejar();
    const p = pagamentoDo(r, 'p204');
    expect(p.refundedAmount).toBe('400.00');
    expect(r.plano.estornos).toEqual([
      expect.objectContaining({
        paymentId: p.id,
        amount: '400.00',
        reason: RefundReason.WRONG_PAYMENT_METHOD,
        notes: 'Cobrado no cartão errado',
        accountId: r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '9'),
        cashSessionId: null,
        refundedById: 'func-2',
      }),
    ]);
    const saida = r.plano.lancamentos.find(
      (l) => l.refundId === r.plano.estornos[0].id,
    )!;
    expect(saida).toMatchObject({
      direction: FinancialEntryDirection.OUT,
      kind: FinancialEntryKind.REFUND,
      amount: '400.00',
    });
    const c106 = cobrancaDa(r, '106')!;
    expect(c106).toMatchObject({
      totalAmount: '0.00',
      paidAmount: '0.00',
      status: ReceivableStatus.PAID,
    });
    const item = r.plano.itens.find((i) => i.receivableId === c106.id)!;
    expect(item.cancelledAt?.toISOString()).toBe('2025-06-05T15:00:00.000Z');
  });

  it('movimento na conta do paciente não vira lançamento (representado pelo estorno)', () => {
    const r = planejar();
    expect(r.ctx.relatorio.extras.transferenciasDePaciente).toBe(1);
    expect(
      r.plano.lancamentos.some((l) =>
        l.description?.startsWith('Cancelamento'),
      ),
    ).toBe(false);
  });

  it('dados de demonstração não migram e vão ao relatório (D5)', () => {
    const r = planejar();
    expect(r.ctx.ledger.resolver(LEDGER_COBRANCA, '105')).toBeNull();
    expect(r.ctx.ledger.resolver(LEDGER_PAGAMENTO, 'p203')).toBeNull();
    expect(r.plano.estornos).toHaveLength(1);
    expect(r.ctx.relatorio.extras.demonstracao).toEqual(
      expect.arrayContaining([
        { tabela: 'contas', id: '105', valor: '999.99' },
        { tabela: 'movimentacao', id: 'p203', valor: '999.99' },
        { tabela: 'devolucoes', id: '1' },
        { tabela: 'movimentacao', id: 't304', valor: '79.00' },
      ]),
    );
  });

  it('inativa, pagamento zero e cobrança sem paciente ficam de fora com o motivo', () => {
    const r = planejar();
    const motivos = r.ctx.relatorio.rejeicoes.map(
      (x) => `${x.entidade}:${x.idOrigem}:${x.motivo}`,
    );
    expect(motivos).toEqual(
      expect.arrayContaining([
        'cobrança:107:cobrança inativa no Feegow',
        'pagamento:p208:pagamento de valor zero',
        'cobrança:104:paciente fora do ledger (sem banco: CPF não conferido)',
        'pagamento:p207:cobrança do pagamento não migrada',
      ]),
    );
  });
});

describe('planejarFinanceiro — D2 (paciente fora do ledger)', () => {
  const base = (pacientesPorCpf: Map<string, string[]>) => ({
    contasPorNome: new Map(),
    formas: new Map(),
    pacientesPorCpf,
    consultasComCobranca: new Set<string>(),
  });

  it('CPF único no tenant casa o paciente', () => {
    const r = planejar(
      {},
      { financeiro: base(new Map([['52998224725', ['pac-db']]])) },
    );
    expect(cobrancaDa(r, '104')?.patientId).toBe('pac-db');
    expect(pagamentoDo(r, 'p207')).toBeDefined();
  });

  it('CPF repetido ou ausente vai ao relatório; nunca casa por nome', () => {
    const repetido = planejar(
      {},
      { financeiro: base(new Map([['52998224725', ['a', 'b']]])) },
    );
    expect(cobrancaDa(repetido, '104')).toBeUndefined();
    expect(repetido.ctx.relatorio.rejeicoes.map((x) => x.motivo)).toContain(
      'paciente fora do ledger com CPF repetido no tenant (D2): lançar à mão',
    );
    const semCpf = planejar(
      { pacientes: [{ id: '99', nome_paciente: 'Maria Silva', cpf: null }] },
      { financeiro: base(new Map()) },
    );
    expect(semCpf.ctx.relatorio.rejeicoes.map((x) => x.motivo)).toContain(
      'paciente fora do ledger e sem CPF válido (D2): lançar à mão',
    );
  });

  it('consulta que já tem cobrança ativa na INEXCI não é reaproveitada', () => {
    const r = planejar(
      {},
      {
        financeiro: {
          ...base(new Map()),
          consultasComCobranca: new Set(['cons-1']),
        },
      },
    );
    expect(cobrancaDa(r, '100')?.appointmentId).toBeNull();
  });
});

describe('planejarFinanceiro — caixa', () => {
  it('caixa com fechamento: contado = esperado = valor do fechamento, com o par de lançamentos', () => {
    const r = planejar();
    const caixa = caixaDo(r, '1');
    expect(caixa).toMatchObject({
      userId: 'func-2',
      accountId: r.ctx.ledger.resolver(LEDGER_CONTA_FINANCEIRA, '6'),
      openingAmount: '0.00',
      countedAmount: '100.00',
      expectedAmount: '100.00',
      difference: '0.00',
      closedById: 'func-2',
      notes: null,
    });
    expect(caixa.closedAt.toISOString()).toBe('2025-06-01T21:00:00.000Z');
    const fechamento = r.plano.lancamentos.filter(
      (l) => l.kind === FinancialEntryKind.SESSION_CLOSING,
    );
    expect(
      fechamento.map((l) => [l.direction, l.cashSessionId, l.accountId]),
    ).toEqual([
      [FinancialEntryDirection.OUT, caixa.id, null],
      [FinancialEntryDirection.IN, null, caixa.accountId],
    ]);
    expect(r.plano.contrapartidas).toEqual(
      expect.arrayContaining([
        [fechamento[0].id, fechamento[1].id],
        [fechamento[1].id, fechamento[0].id],
      ]),
    );
  });

  it('lançamento avulso vira ajuste com a descrição preservada', () => {
    const r = planejar();
    const ajuste = r.plano.lancamentos.find(
      (l) => l.kind === FinancialEntryKind.ADJUSTMENT,
    )!;
    expect(ajuste).toMatchObject({
      direction: FinancialEntryDirection.OUT,
      cashSessionId: caixaDo(r, '1').id,
      amount: '10.00',
      description: 'Lançamento avulso',
    });
  });

  it('caixa aberto entra fechado no último movimento, com nota e sem diferença (D4)', () => {
    const r = planejar();
    const caixa = caixaDo(r, '2');
    expect(caixa).toMatchObject({
      notes: NOTA_FECHADO_NA_MIGRACAO,
      countedAmount: '50.00',
      expectedAmount: '50.00',
      difference: '0.00',
      closedById: null,
    });
    expect(caixa.closedAt.toISOString()).toBe('2025-06-02T18:00:00.000Z');
    expect(r.ctx.relatorio.extras.caixasFechadosNaMigracao).toEqual([
      expect.objectContaining({ caixa: '2', saldoEmDinheiro: '50.00' }),
    ]);
    const retirada = r.plano.lancamentos.filter((l) =>
      [FinancialEntryKind.WITHDRAWAL, FinancialEntryKind.TRANSFER].includes(
        l.kind,
      ),
    );
    expect(retirada.map((l) => [l.kind, l.direction, l.cashSessionId])).toEqual(
      [
        [FinancialEntryKind.WITHDRAWAL, FinancialEntryDirection.OUT, caixa.id],
        [FinancialEntryKind.TRANSFER, FinancialEntryDirection.IN, null],
      ],
    );
  });

  it('usuário do caixa sem correspondência: dono + aviso', () => {
    const r = planejar({
      caixas: [
        {
          id: '1',
          data_hora_abertura: '2025-06-01 08:00:00',
          data_hora_fechamento: '2025-06-01 18:00:00',
          usuario_id: '555',
          conta_corrente_id: '6',
        },
      ],
    });
    expect(caixaDo(r, '1').userId).toBe(OWNER);
    expect(
      r.ctx.relatorio.avisos.some((a) =>
        a.aviso.startsWith('usuário do caixa'),
      ),
    ).toBe(true);
  });
});

describe('planejarFinanceiro — valor da consulta e somas', () => {
  it('valor previsto só para consultas do ledger com valor > 0', () => {
    const r = planejar();
    expect(r.plano.precos).toEqual([
      { agendamento: 'ag-1', appointmentId: 'cons-1', price: '300.00' },
      { agendamento: 'ag-3', appointmentId: 'cons-3', price: '250.00' },
    ]);
  });

  it('somas por ano e por forma: export × migrado, com a diferença do que ficou de fora', () => {
    const r = planejar();
    expect(resumoDoExport(lerFinanceiro(r.exp))).toEqual({
      somas: {
        porAno: { '2025': 58000, '2026': 20000 },
        porForma: {
          cash: 18000,
          pix: 25000,
          credit_card: 15000,
          debit_card: 0,
          other: 20000,
        },
      },
      abertas: 1,
      parciais: 1,
    });
    const somas = r.ctx.relatorio.extras.somas as {
      porAno: Record<string, Record<string, string>>;
      porForma: Record<string, Record<string, string>>;
      abertas: Record<string, number>;
    };
    expect(somas.porAno['2025']).toEqual({
      export: '580.00',
      migrado: '530.00',
      diferenca: '50.00',
    });
    expect(somas.porAno['2026'].diferenca).toBe('0.00');
    expect(somas.porForma.pix.diferenca).toBe('50.00');
    expect(somas.abertas).toEqual({ export: 1, migrado: 1 });
  });
});
