import { LinhaCsv } from '../../core/csv';
import { Ledger } from '../../core/ledger';
import { ExportFeegow } from '../export';

type Linha = Partial<Record<string, string | null>>;
type Tabelas = Record<string, Linha[]>;

export function ledgerDaCarga(): Ledger {
  const ledger = new Ledger(null);
  ledger.registrar('patient', '10', 'pac-10');
  ledger.registrar('patient', '11', 'pac-11');
  ledger.registrar('appointment', 'ag-1', 'cons-1');
  ledger.registrar('appointment', 'ag-2', 'cons-2');
  ledger.registrar('appointment', 'ag-3', 'cons-3');
  ledger.registrar('user:prof', '1', 'prof-1');
  ledger.registrar('user:func', '2', 'func-2');
  return ledger;
}

export function conta(
  id: string,
  paciente: string,
  data: string,
  extra: Linha = {},
): Linha {
  return {
    id,
    associacao_conta_id: '3',
    conta_id: paciente,
    data_referencia: data,
    valor: '0.00',
    sys_user: '900',
    sys_date: `${data} 09:00:00`,
    sys_active: '1',
    ...extra,
  };
}

export function item(
  id: string,
  contaId: string,
  valor: string,
  extra: Linha = {},
): Linha {
  return {
    id,
    conta_id: contaId,
    Quantidade: '1',
    valor_unitario: valor,
    desconto: '0.00',
    acrescimo: '0.00',
    procedimento_id: '10',
    descricao: null,
    agendamento_id: null,
    is_cancelado: '0',
    data_execucao: '2025-06-01',
    executante_id: '1',
    executante_associacao_id: '5',
    dhup: '2025-06-01 09:00:00',
    ...extra,
  };
}

export function parcela(id: string, contaId: string, data: string): Linha {
  return {
    id,
    tipo_movimentacao: 'Bill',
    associacao_conta_id_debito: '3',
    conta_id_debito: '10',
    associacao_conta_id_credito: '0',
    conta_id_credito: '0',
    conta_id: contaId,
    data,
    valor: '0.00',
    dhup: `${data} 09:00:00`,
  };
}

export function pagamento(
  id: string,
  forma: string,
  valor: string,
  destino: { caixa?: string; conta?: string },
  extra: Linha = {},
): Linha {
  return {
    id,
    tipo_movimentacao: 'Pay',
    associacao_conta_id_debito: destino.caixa ? '7' : '1',
    conta_id_debito: destino.caixa ?? destino.conta ?? '0',
    associacao_conta_id_credito: '3',
    conta_id_credito: '10',
    valor,
    data: '2025-06-01',
    forma_pagamento_id: forma,
    sys_user: '900',
    caixa_id: destino.caixa ?? null,
    dhup: '2025-06-01 10:30:00',
    ...extra,
  };
}

export function transferencia(
  id: string,
  descricao: string,
  valor: string,
  extra: Linha = {},
): Linha {
  return {
    id,
    tipo_movimentacao: 'Transfer',
    associacao_conta_id_debito: '1',
    conta_id_debito: '6',
    associacao_conta_id_credito: '7',
    conta_id_credito: '1',
    valor,
    data: '2025-06-01',
    descricao,
    forma_pagamento_id: '1',
    sys_user: '900',
    caixa_id: '1',
    dhup: '2025-06-01 18:00:00',
    ...extra,
  };
}

export function tabelasFinanceiras(): Tabelas {
  return {
    usuarios: [
      { id: '900', tipo_usuario: 'Funcionarios', id_relativo: '2' },
      { id: '901', tipo_usuario: 'Profissionais', id_relativo: '1' },
    ],
    pacientes: [
      { id: '10', cpf: null },
      { id: '11', cpf: null },
      { id: '99', cpf: '529.982.247-25' },
    ],
    procedimentos: [{ id: '10', nome_procedimento: 'Consulta exemplo' }],
    contas_correntes: [
      {
        id: '1',
        nome_conta_corrente: 'Tesouraria (exemplo)',
        tipo_conta_corrente: '1',
        sys_active: '-1',
      },
      {
        id: '6',
        nome_conta_corrente: 'Caixa Físico',
        tipo_conta_corrente: '1',
        sys_active: '1',
      },
      {
        id: '7',
        nome_conta_corrente: 'Stone',
        tipo_conta_corrente: '2',
        sys_active: '1',
      },
      {
        id: '8',
        nome_conta_corrente: 'Stone - Crédito',
        tipo_conta_corrente: '3',
        sys_active: '1',
      },
      {
        id: '9',
        nome_conta_corrente: 'Stone - Débito',
        tipo_conta_corrente: '4',
        sys_active: '1',
      },
    ],
    formas_pagamento: [{ id: '1', forma_pagamento: 'Dinheiro' }],
    formas_recebimentos: [
      { id: '2', MetodoID: '8', Contas: '|8|', ParcelasAte: '12' },
      { id: '7', MetodoID: '8', Contas: '|ALL|', ParcelasAte: '1' },
      { id: '3', MetodoID: '9', Contas: '|9|', ParcelasAte: '1' },
      { id: '5', MetodoID: '1', Contas: '|6|', ParcelasAte: '1' },
      { id: '6', MetodoID: '15', Contas: '|7|', ParcelasAte: '1' },
    ],
    caixas: [
      {
        id: '1',
        data_hora_abertura: '2025-06-01 08:00:00',
        data_hora_fechamento: '2025-06-01 18:00:00',
        usuario_id: '900',
        conta_corrente_id: '6',
      },
      {
        id: '2',
        data_hora_abertura: '2025-06-02 08:00:00',
        data_hora_fechamento: null,
        usuario_id: '900',
        conta_corrente_id: '6',
      },
    ],
    contas: [
      conta('100', '10', '2025-06-01'),
      conta('101', '11', '2025-06-02'),
      conta('102', '10', '2025-06-02'),
      conta('103', '10', '2025-06-03'),
      conta('104', '99', '2025-06-04'),
      conta('105', '10', '2023-08-16'),
      conta('106', '10', '2025-06-05'),
      conta('107', '10', '2025-06-06', { sys_active: '0' }),
      conta('108', '11', '2025-06-07'),
      conta('109', '11', '2025-06-02'),
    ],
    conta_itens: [
      item('1000', '100', '300.00', { agendamento_id: 'ag-1' }),
      item('1010', '101', '400.00', { agendamento_id: 'ag-2' }),
      item('1020', '102', '0.00'),
      item('1030', '103', '250.00', { agendamento_id: 'ag-fora' }),
      item('1040', '104', '50.00'),
      item('1050', '105', '999.99'),
      item('1060', '106', '400.00', {
        is_cancelado: '1',
        dhup: '2025-06-05 12:00:00',
      }),
      item('1080', '108', '200.00', { descricao: 'Retorno combinado' }),
      item('1090', '109', '80.00'),
    ],
    movimentacao: [
      parcela('b100', '100', '2025-06-01'),
      parcela('b101', '101', '2025-06-02'),
      parcela('b102', '102', '2025-06-02'),
      parcela('b103', '103', '2025-06-03'),
      parcela('b104', '104', '2025-06-04'),
      parcela('b105', '105', '2023-08-16'),
      parcela('b106', '106', '2025-06-05'),
      parcela('b108', '108', '2025-06-07'),
      parcela('b109', '109', '2025-06-02'),
      pagamento('p200', '1', '100.00', { caixa: '1' }),
      pagamento('p201', '15', '200.00', { conta: '7' }, { caixa_id: '1' }),
      pagamento(
        'p202',
        '8',
        '150.00',
        { conta: '8' },
        { data: '2025-06-02', dhup: '2025-06-03 14:15:16' },
      ),
      pagamento('p203', '1', '999.99', { conta: '1' }, { data: '2023-08-16' }),
      pagamento('p204', '9', '400.00', { conta: '9' }, { data: '2025-06-05' }),
      pagamento('p205', '12', '200.00', { conta: '7' }, { data: '2026-01-10' }),
      pagamento(
        'p206',
        '1',
        '80.00',
        { caixa: '2' },
        { data: '2025-06-02', dhup: '2025-06-02 11:00:00' },
      ),
      pagamento('p207', '15', '50.00', { conta: '7' }),
      pagamento('p208', '15', '0.00', { conta: '7' }),
      transferencia('t300', 'Fechamento Cx - Dinheiro', '100.00'),
      transferencia('t301', 'RETIRADA', '30.00', {
        conta_id_credito: '2',
        caixa_id: '2',
        data: '2025-06-02',
        dhup: '2025-06-02 15:00:00',
      }),
      transferencia('t302', 'Cancelamento de serviço (1060)', '400.00', {
        associacao_conta_id_debito: '0',
        conta_id_debito: '0',
        associacao_conta_id_credito: '3',
        conta_id_credito: '10',
        caixa_id: null,
      }),
      transferencia('t303', 'Lançamento avulso', '10.00', {
        associacao_conta_id_debito: '4',
        conta_id_debito: '3',
      }),
      transferencia('t304', 'Devolução (5)', '79.00', {
        data: '2023-08-23',
        associacao_conta_id_debito: '3',
        conta_id_debito: '10',
        associacao_conta_id_credito: '1',
        conta_id_credito: '1',
      }),
    ],
    pagamento_associacao: [
      ['p200', 'b100', '100.00'],
      ['p201', 'b100', '200.00'],
      ['p202', 'b101', '150.00'],
      ['p203', 'b105', '999.99'],
      ['p204', 'b106', '400.00'],
      ['p205', 'b108', '200.00'],
      ['p206', 'b109', '80.00'],
      ['p207', 'b104', '50.00'],
    ].map(([pagamento_id, parcela_id, valor], i) => ({
      id: String(i + 1),
      pagamento_id,
      parcela_id,
      valor_descontado: valor,
    })),
    transacao_cartao: [
      {
        id: '1',
        movimentacao_id: 'p202',
        parcelas: '3',
        bandeira_cartao_id: '2',
        numero_transacao: 'NSU1',
        numero_autorizacao: null,
      },
      {
        id: '2',
        movimentacao_id: 'p204',
        parcelas: '1',
        bandeira_cartao_id: '0',
        numero_transacao: null,
        numero_autorizacao: null,
      },
    ],
    bandeiras_cartao: [{ id: '2', Bandeira: 'Mastercard' }],
    motivo_devolucao: [
      { ID: '1', Motivo: 'Outros' },
      { ID: '4', Motivo: 'Erro na forma de pagamento' },
    ],
    devolucoes: [
      {
        id: '1',
        invoiceID: '105',
        motivoDevolucaoID: '1',
        observacao: 'teste',
        totalDevolucao: '79.00',
        AccountID: '1',
        sysUser: '0',
        sysDate: '2023-08-23 10:55:55',
        sysActive: '1',
      },
      {
        id: '2',
        invoiceID: '106',
        motivoDevolucaoID: '4',
        observacao: 'Cobrado no cartão errado',
        totalDevolucao: '400.00',
        AccountID: null,
        sysUser: '900',
        sysDate: '2025-06-05 12:00:00',
        sysActive: '1',
      },
    ],
    agendamentos: [
      { id: 'ag-1', valor: '300.00' },
      { id: 'ag-2', valor: '0.00' },
      { id: 'ag-3', valor: '250.00' },
      { id: 'ag-fora', valor: '200.00' },
    ],
    movimentacao_removidos: [{ id: '1' }],
    conta_itens_cancelados: [],
  };
}

export function exportFinanceiro(sobrescrever: Tabelas = {}): ExportFeegow {
  return new ExportFeegow(null, {
    ...tabelasFinanceiras(),
    ...sobrescrever,
  } as Record<string, LinhaCsv[]>);
}
