import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import {
  MAX_INSTALLMENTS_LIMIT,
  PaymentMethod,
} from 'src/database/entities/payment-method-config.entity';
import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import { deCentavos, paraCentavos } from 'src/modules/finance/utils/dinheiro';
import { statusDaCobranca } from 'src/modules/finance/utils/status-da-cobranca';
import { LinhaCsv } from '../../core/csv';
import {
  dataHoraCompleta,
  dataHoraSaoPaulo,
  normalizarCpf,
  normalizarData,
  normalizarTexto,
} from '../../core/normalizers';
import { chaveDeNome, ContextoImportacao } from '../context';
import { ExportFeegow, excluido } from '../export';
import {
  ASSOCIACAO_CAIXA,
  ASSOCIACAO_CONTA_CORRENTE,
  ASSOCIACAO_PACIENTE,
  bandeiraDoCartao,
  ehDemonstracao,
  formaDePagamento,
  FormaDePagamento,
  horaDoDhup,
  listaDeIds,
  motivoDoEstorno,
  parcelasDoCartao,
  tipoDaConta,
  TipoDeTransferencia,
  tipoDaTransferencia,
} from '../rules/finance.rules';
import { LEDGER_CONSULTA, nomeDeProcedimento } from './appointment.mapper';
import { LEDGER_PACIENTE } from './patient.mapper';
import { autoresDoFeegow, LEDGER_PROFISSIONAL } from './team.mapper';

export const LEDGER_CONTA_FINANCEIRA = 'financial_account';
export const LEDGER_FORMA_DE_PAGAMENTO = 'payment_method_config';
export const LEDGER_CAIXA = 'cash_session';
export const LEDGER_COBRANCA = 'receivable';
export const LEDGER_ITEM_DE_COBRANCA = 'receivable_item';
export const LEDGER_PAGAMENTO = 'payment';
export const LEDGER_ESTORNO = 'refund';
export const LEDGER_LANCAMENTO = 'financial_entry';
export const LEDGER_PRECO_DA_CONSULTA = 'appointment_price';

export const LEDGERS_FINANCEIROS = [
  LEDGER_CONTA_FINANCEIRA,
  LEDGER_FORMA_DE_PAGAMENTO,
  LEDGER_CAIXA,
  LEDGER_COBRANCA,
  LEDGER_ITEM_DE_COBRANCA,
  LEDGER_PAGAMENTO,
  LEDGER_ESTORNO,
  LEDGER_LANCAMENTO,
  LEDGER_PRECO_DA_CONSULTA,
];

export const NOTA_FECHADO_NA_MIGRACAO = 'fechado na migração';

const ASSOCIACAO_PROFISSIONAL = '5';

export interface DadosFinanceirosDoBanco {
  contasPorNome: Map<
    string,
    { id: string; type: FinancialAccountType; active: boolean }
  >;
  formas: Map<
    PaymentMethod,
    { id: string; defaultAccountId: string | null; maxInstallments: number }
  >;
  pacientesPorCpf: Map<string, string[]>;
  consultasComCobranca: Set<string>;
}

interface Lado {
  associacao: string | null;
  id: string | null;
}

export interface ItemLido {
  id: string;
  descricao: string;
  executante: string | null;
  executadoEm: string | null;
  quantidade: number;
  unitario: number;
  desconto: number;
  acrescimo: number;
  total: number;
  canceladoEm: Date | null;
  agendamento: string | null;
}

export interface PagamentoLido {
  id: string;
  conta: string | null;
  valor: number;
  formaId: string | null;
  forma: FormaDePagamento;
  pagoEm: Date | null;
  ano: string | null;
  destino: Lado;
  caixa: string | null;
  autor: string | null;
  estornado: number;
  demo: boolean;
  motivoDeFora: string | null;
}

export interface EstornoLido {
  chave: string;
  devolucao: string;
  pagamento: PagamentoLido;
  valor: number;
  motivo: RefundReason;
  notas: string | null;
  em: Date | null;
  ano: string | null;
  autor: string | null;
  contaCorrente: string | null;
}

export interface CobrancaLida {
  id: string;
  paciente: string | null;
  referencia: string | null;
  vencimento: string | null;
  criadaEm: Date | null;
  autor: string | null;
  itens: ItemLido[];
  total: number;
  pagamentos: PagamentoLido[];
  estornos: EstornoLido[];
  pago: number;
  status: ReceivableStatus;
  demo: boolean;
  motivoDeFora: string | null;
}

export interface TransferenciaLida {
  id: string;
  tipo: TipoDeTransferencia;
  valor: number | null;
  em: Date | null;
  descricao: string | null;
  debito: Lado;
  credito: Lado;
  autor: string | null;
  demo: boolean;
}

export interface CaixaLido {
  id: string;
  usuario: string | null;
  conta: string | null;
  abertura: Date | null;
  fechamento: Date | null;
  ultimoMovimento: Date | null;
  demo: boolean;
}

export interface ContaCorrenteLida {
  id: string;
  nome: string | null;
  tipo: FinancialAccountType;
  ativa: boolean;
  demo: boolean;
}

export interface ModeloFinanceiro {
  contasCorrentes: ContaCorrenteLida[];
  caixas: CaixaLido[];
  cobrancas: Map<string, CobrancaLida>;
  pagamentos: PagamentoLido[];
  estornos: EstornoLido[];
  sobrasDeDevolucao: { devolucao: string; valor: number }[];
  devolucoesDeFora: { id: string; motivo: string; demo: boolean }[];
  transferencias: TransferenciaLida[];
  itensComSinalInvertido: string[];
}

const centavos = (valor: string | null | undefined): number | null => {
  try {
    return paraCentavos(valor ?? '0');
  } catch {
    return null;
  }
};

const semZero = (valor: string | null | undefined): string | null => {
  const v = (valor ?? '').trim();
  return v && v !== '0' ? v : null;
};

const lado = (associacao: string | null, id: string | null): Lado => ({
  associacao: semZero(associacao),
  id: semZero(id),
});

export const momentoDaMovimentacao = (l: LinhaCsv): Date | null =>
  dataHoraSaoPaulo(l.data, horaDoDhup(l.dhup)) ?? dataHoraCompleta(l.dhup);

const anoDe = (data: string | null | undefined): string | null =>
  normalizarData(data)?.slice(0, 4) ?? null;

export function lerFinanceiro(exp: ExportFeegow): ModeloFinanceiro {
  const contasCorrentes = exp.tabela('contas_correntes').map(
    (l): ContaCorrenteLida => ({
      id: l.id ?? '',
      nome: normalizarTexto(l.nome_conta_corrente, 80),
      tipo: tipoDaConta(l.nome_conta_corrente, l.tipo_conta_corrente),
      ativa: l.sys_active === '1',
      demo: excluido(l),
    }),
  );

  const movimentacao = exp.tabela('movimentacao');
  const porTipo = (tipo: string) =>
    movimentacao.filter((m) => m.tipo_movimentacao === tipo);
  const movimentoPorId = new Map(movimentacao.map((m) => [m.id ?? '', m]));

  const ultimoPorCaixa = new Map<string, Date>();
  for (const m of movimentacao) {
    const momento = momentoDaMovimentacao(m);
    if (!momento) continue;
    const caixas = [
      semZero(m.caixa_id),
      m.associacao_conta_id_debito === ASSOCIACAO_CAIXA
        ? semZero(m.conta_id_debito)
        : null,
      m.associacao_conta_id_credito === ASSOCIACAO_CAIXA
        ? semZero(m.conta_id_credito)
        : null,
    ];
    for (const c of caixas) {
      if (!c) continue;
      const atual = ultimoPorCaixa.get(c);
      if (!atual || atual < momento) ultimoPorCaixa.set(c, momento);
    }
  }

  const caixas = exp.tabela('caixas').map(
    (c): CaixaLido => ({
      id: c.id ?? '',
      usuario: semZero(c.usuario_id),
      conta: semZero(c.conta_corrente_id),
      abertura: dataHoraCompleta(c.data_hora_abertura),
      fechamento: dataHoraCompleta(c.data_hora_fechamento),
      ultimoMovimento: ultimoPorCaixa.get(c.id ?? '') ?? null,
      demo: ehDemonstracao(c.data_hora_abertura),
    }),
  );

  const parcelaPorConta = new Map<string, LinhaCsv>();
  for (const b of porTipo('Bill')) {
    const conta = semZero(b.conta_id);
    if (conta && !parcelaPorConta.has(conta)) parcelaPorConta.set(conta, b);
  }
  const itensPorConta = new Map<string, LinhaCsv[]>();
  for (const i of exp.tabela('conta_itens')) {
    const conta = i.conta_id ?? '';
    itensPorConta.set(conta, [...(itensPorConta.get(conta) ?? []), i]);
  }
  const procedimentos = new Map(
    exp.tabela('procedimentos').map((p) => [p.id ?? '', p.nome_procedimento]),
  );

  const cobrancas = new Map<string, CobrancaLida>();
  const sinaisInvertidos: string[] = [];
  for (const c of exp.tabela('contas')) {
    const id = c.id ?? '';
    const parcela = parcelaPorConta.get(id);
    const referencia =
      normalizarData(c.data_referencia) ?? normalizarData(parcela?.data);
    let motivoDeFora: string | null =
      c.sys_active !== '1'
        ? excluido(c)
          ? 'cobrança excluída no Feegow'
          : 'cobrança inativa no Feegow'
        : c.associacao_conta_id !== ASSOCIACAO_PACIENTE
          ? 'cobrança não é de paciente'
          : !referencia
            ? 'cobrança sem data de referência'
            : null;
    const itens: ItemLido[] = [];
    for (const i of itensPorConta.get(id) ?? []) {
      const unitario = centavos(i.valor_unitario);
      const descontoLido = centavos(i.desconto);
      const acrescimoLido = centavos(i.acrescimo);
      const desconto =
        descontoLido === null || acrescimoLido === null
          ? null
          : Math.max(descontoLido, 0) - Math.min(acrescimoLido, 0);
      const acrescimo =
        descontoLido === null || acrescimoLido === null
          ? null
          : Math.max(acrescimoLido, 0) - Math.min(descontoLido, 0);
      if (
        (descontoLido !== null && descontoLido < 0) ||
        (acrescimoLido !== null && acrescimoLido < 0)
      ) {
        sinaisInvertidos.push(i.id ?? '');
      }
      const quantidade = Number(i.Quantidade ?? '1');
      if (
        unitario === null ||
        desconto === null ||
        acrescimo === null ||
        !Number.isInteger(quantidade) ||
        quantidade < 1
      ) {
        motivoDeFora ??= 'valor ou quantidade inválida no item da cobrança';
        continue;
      }
      itens.push({
        id: i.id ?? '',
        descricao:
          normalizarTexto(i.descricao, 150) ??
          normalizarTexto(
            nomeDeProcedimento(procedimentos.get(i.procedimento_id ?? '')),
            150,
          ) ??
          'Serviço',
        executante:
          i.executante_associacao_id === ASSOCIACAO_PROFISSIONAL
            ? semZero(i.executante_id)
            : null,
        executadoEm: normalizarData(i.data_execucao),
        quantidade,
        unitario,
        desconto,
        acrescimo,
        total: quantidade * unitario - desconto + acrescimo,
        canceladoEm:
          i.is_cancelado === '1'
            ? (dataHoraCompleta(i.dhup) ??
              dataHoraCompleta(i.data_hora) ??
              dataHoraSaoPaulo(referencia))
            : null,
        agendamento: semZero(i.agendamento_id),
      });
    }
    cobrancas.set(id, {
      id,
      paciente: semZero(c.conta_id),
      referencia,
      vencimento: normalizarData(parcela?.data) ?? referencia,
      criadaEm: dataHoraCompleta(c.sys_date) ?? dataHoraSaoPaulo(referencia),
      autor: semZero(c.sys_user),
      itens,
      total: itens
        .filter((i) => !i.canceladoEm)
        .reduce((s, i) => s + i.total, 0),
      pagamentos: [],
      estornos: [],
      pago: 0,
      status: ReceivableStatus.OPEN,
      demo: ehDemonstracao(c.data_referencia),
      motivoDeFora,
    });
  }

  const associacoesPorPagamento = new Map<string, LinhaCsv[]>();
  for (const a of exp.tabela('pagamento_associacao')) {
    const p = a.pagamento_id ?? '';
    associacoesPorPagamento.set(p, [
      ...(associacoesPorPagamento.get(p) ?? []),
      a,
    ]);
  }

  const pagamentos: PagamentoLido[] = [];
  for (const p of porTipo('Pay')) {
    const id = p.id ?? '';
    const valor = centavos(p.valor);
    const associacao = associacoesPorPagamento.get(id)?.[0];
    const parcela = associacao
      ? movimentoPorId.get(associacao.parcela_id ?? '')
      : undefined;
    const contaId = semZero(parcela?.conta_id);
    const cobranca = contaId ? cobrancas.get(contaId) : undefined;
    const pagoEm = momentoDaMovimentacao(p);
    const motivoDeFora =
      valor === null
        ? 'valor inválido'
        : valor <= 0
          ? 'pagamento de valor zero'
          : !associacao
            ? 'pagamento sem cobrança associada'
            : !cobranca
              ? 'cobrança do pagamento não está no export'
              : cobranca.motivoDeFora
                ? `cobrança do pagamento não migra (${cobranca.motivoDeFora})`
                : !pagoEm
                  ? 'data do pagamento inválida'
                  : null;
    const lido: PagamentoLido = {
      id,
      conta: contaId,
      valor: valor ?? 0,
      formaId: semZero(p.forma_pagamento_id),
      forma: formaDePagamento(p.forma_pagamento_id),
      pagoEm,
      ano: anoDe(p.data),
      destino: lado(p.associacao_conta_id_debito, p.conta_id_debito),
      caixa: semZero(p.caixa_id),
      autor: semZero(p.sys_user),
      estornado: 0,
      demo: ehDemonstracao(p.data) || !!cobranca?.demo,
      motivoDeFora,
    };
    pagamentos.push(lido);
    if (cobranca && !lido.demo && !lido.motivoDeFora) {
      cobranca.pagamentos.push(lido);
    }
  }

  const motivos = new Map(
    exp.tabela('motivo_devolucao').map((m) => [m.ID ?? '', m.Motivo]),
  );
  const estornos: EstornoLido[] = [];
  const sobrasDeDevolucao: ModeloFinanceiro['sobrasDeDevolucao'] = [];
  const devolucoesDeFora: ModeloFinanceiro['devolucoesDeFora'] = [];
  for (const d of exp.tabela('devolucoes')) {
    const id = d.id ?? '';
    const cobranca = cobrancas.get(d.invoiceID ?? '');
    const demo = ehDemonstracao(d.sysDate) || !!cobranca?.demo;
    const valor = centavos(d.totalDevolucao);
    const motivoDeFora =
      d.sysActive !== '1'
        ? 'devolução inativa no Feegow'
        : !cobranca || cobranca.motivoDeFora
          ? 'cobrança da devolução não migra'
          : valor === null || valor <= 0
            ? 'valor da devolução inválido'
            : null;
    if (demo || motivoDeFora || !cobranca || valor === null) {
      devolucoesDeFora.push({
        id,
        motivo: motivoDeFora ?? 'dado de demonstração do Feegow',
        demo,
      });
      continue;
    }
    const textoDoMotivo = normalizarTexto(
      motivos.get(d.motivoDevolucaoID ?? ''),
      120,
    );
    const { motivo } = motivoDoEstorno(textoDoMotivo);
    const notas = [
      normalizarTexto(d.observacao, 500),
      motivo === RefundReason.OTHER &&
      textoDoMotivo &&
      chaveDeNome(textoDoMotivo) !== 'outro motivo'
        ? `Motivo no Feegow: ${textoDoMotivo}`
        : null,
    ]
      .filter(Boolean)
      .join(' — ');
    let resto = valor;
    const candidatos = [...cobranca.pagamentos].sort(
      (a, b) => (b.pagoEm?.getTime() ?? 0) - (a.pagoEm?.getTime() ?? 0),
    );
    for (const pagamento of candidatos) {
      if (resto <= 0) break;
      const parte = Math.min(resto, pagamento.valor - pagamento.estornado);
      if (parte <= 0) continue;
      pagamento.estornado += parte;
      resto -= parte;
      const estorno: EstornoLido = {
        chave: `${id}:${pagamento.id}`,
        devolucao: id,
        pagamento,
        valor: parte,
        motivo,
        notas: notas || null,
        em: dataHoraCompleta(d.sysDate) ?? pagamento.pagoEm,
        ano: anoDe(d.sysDate) ?? pagamento.ano,
        autor: semZero(d.sysUser),
        contaCorrente: semZero(d.AccountID),
      };
      estornos.push(estorno);
      cobranca.estornos.push(estorno);
    }
    if (resto > 0) sobrasDeDevolucao.push({ devolucao: id, valor: resto });
  }

  for (const c of cobrancas.values()) {
    c.pago =
      c.pagamentos.reduce((s, p) => s + p.valor, 0) -
      c.estornos.reduce((s, e) => s + e.valor, 0);
    c.status = statusDaCobranca({
      totalAmount: deCentavos(c.total),
      paidAmount: deCentavos(c.pago),
    });
  }

  const transferencias = porTipo('Transfer').map(
    (t): TransferenciaLida => ({
      id: t.id ?? '',
      tipo: tipoDaTransferencia(t),
      valor: centavos(t.valor),
      em: momentoDaMovimentacao(t),
      descricao: normalizarTexto(t.descricao, 255),
      debito: lado(t.associacao_conta_id_debito, t.conta_id_debito),
      credito: lado(t.associacao_conta_id_credito, t.conta_id_credito),
      autor: semZero(t.sys_user),
      demo: ehDemonstracao(t.data),
    }),
  );

  return {
    contasCorrentes,
    caixas,
    cobrancas,
    pagamentos,
    estornos,
    sobrasDeDevolucao,
    devolucoesDeFora,
    transferencias,
    itensComSinalInvertido: sinaisInvertidos,
  };
}

export interface SomasFinanceiras {
  porAno: Record<string, number>;
  porForma: Record<string, number>;
}

export interface ResumoFinanceiro {
  somas: SomasFinanceiras;
  abertas: number;
  parciais: number;
}

const acumular = (alvo: Record<string, number>, chave: string, v: number) => {
  alvo[chave] = (alvo[chave] ?? 0) + v;
};

export function resumoDoExport(modelo: ModeloFinanceiro): ResumoFinanceiro {
  const somas: SomasFinanceiras = { porAno: {}, porForma: {} };
  for (const p of modelo.pagamentos) {
    if (p.demo || p.valor <= 0) continue;
    acumular(somas.porAno, p.ano ?? 'sem data', p.valor);
    acumular(somas.porForma, p.forma.metodo, p.valor);
  }
  for (const e of modelo.estornos) {
    acumular(somas.porAno, e.ano ?? 'sem data', -e.valor);
    acumular(somas.porForma, e.pagamento.forma.metodo, -e.valor);
  }
  let abertas = 0;
  let parciais = 0;
  for (const c of modelo.cobrancas.values()) {
    if (c.demo || c.motivoDeFora) continue;
    if (c.status === ReceivableStatus.OPEN) abertas++;
    if (c.status === ReceivableStatus.PARTIAL) parciais++;
  }
  return { somas, abertas, parciais };
}

export interface NovaContaFinanceira {
  id: string;
  ownerId: string;
  name: string;
  type: FinancialAccountType;
  active: boolean;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovaConfiguracaoDeForma {
  id: string;
  ownerId: string;
  method: PaymentMethod;
  active: boolean;
  defaultAccountId: string | null;
  maxInstallments: number;
  createdById: string | null;
}

export interface AtualizacaoDeForma {
  id: string;
  method: PaymentMethod;
  defaultAccountId?: string;
  maxInstallments?: number;
}

export interface NovoCaixa {
  id: string;
  ownerId: string;
  userId: string;
  accountId: string;
  openedAt: Date;
  closedAt: Date;
  openingAmount: string;
  countedAmount: string;
  expectedAmount: string;
  difference: string;
  notes: string | null;
  closedById: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovaCobranca {
  id: string;
  ownerId: string;
  patientId: string;
  appointmentId: string | null;
  referenceDate: string;
  dueDate: string | null;
  totalAmount: string;
  paidAmount: string;
  status: ReceivableStatus;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoItemDeCobranca {
  id: string;
  ownerId: string;
  receivableId: string;
  appointmentId: string | null;
  description: string;
  executedById: string | null;
  executedAt: string | null;
  quantity: number;
  unitAmount: string;
  discount: string;
  surcharge: string;
  total: string;
  cancelledAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoPagamento {
  id: string;
  ownerId: string;
  receivableId: string;
  method: PaymentMethod;
  amount: string;
  refundedAmount: string;
  paidAt: Date;
  accountId: string | null;
  cashSessionId: string | null;
  receivedById: string | null;
  cardBrand: string | null;
  installments: number;
  nsu: string | null;
  authorizationCode: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoEstorno {
  id: string;
  ownerId: string;
  paymentId: string;
  amount: string;
  reason: RefundReason;
  notes: string | null;
  accountId: string | null;
  cashSessionId: string | null;
  refundedById: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoLancamento {
  id: string;
  ownerId: string;
  accountId: string | null;
  cashSessionId: string | null;
  direction: FinancialEntryDirection;
  kind: FinancialEntryKind;
  amount: string;
  paymentId: string | null;
  refundId: string | null;
  occurredAt: Date;
  description: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoPrecoDeConsulta {
  agendamento: string;
  appointmentId: string;
  price: string;
}

export interface PlanoFinanceiroDoExport {
  contas: NovaContaFinanceira[];
  formasNovas: NovaConfiguracaoDeForma[];
  formasAtualizadas: AtualizacaoDeForma[];
  caixas: NovoCaixa[];
  cobrancas: NovaCobranca[];
  itens: NovoItemDeCobranca[];
  pagamentos: NovoPagamento[];
  estornos: NovoEstorno[];
  lancamentos: NovoLancamento[];
  contrapartidas: [string, string][];
  precos: NovoPrecoDeConsulta[];
  resumoDoExport: ResumoFinanceiro;
  resumoDoPlano: ResumoFinanceiro;
}

interface Destino {
  accountId: string | null;
  cashSessionId: string | null;
}

interface CaixaPlanejado {
  novo: NovoCaixa;
  lido: CaixaLido;
  saldo: number;
  fechamento: number | null;
}

const D5 = 'dado de demonstração do Feegow (D5)';

export function planejarFinanceiroDoExport(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoFinanceiroDoExport {
  const rel = ctx.relatorio;
  const banco = ctx.financeiro ?? null;
  const modelo = lerFinanceiro(exp);
  for (const itemId of modelo.itensComSinalInvertido) {
    rel.avisar(
      'item de cobrança',
      itemId,
      'desconto ou acréscimo negativo no Feegow: o sinal foi trocado para o outro campo, com o mesmo total',
    );
  }
  const autores = autoresDoFeegow(exp, ctx);
  const autor = (usuario: string | null) =>
    usuario ? (autores.get(usuario) ?? null) : null;
  const demonstracao: { tabela: string; id: string; valor?: string }[] = [];
  const marcarDemonstracao = (
    entidade: string,
    tabela: string,
    id: string,
    valor?: number | null,
  ) => {
    demonstracao.push({
      tabela,
      id,
      ...(valor !== undefined && valor !== null
        ? { valor: deCentavos(valor) }
        : {}),
    });
    rel.rejeitar(entidade, id, D5);
  };

  const contas: NovaContaFinanceira[] = [];
  const contaPorFeegow = new Map<
    string,
    { id: string; type: FinancialAccountType; active: boolean }
  >();
  for (const c of modelo.contasCorrentes) {
    if (c.demo) {
      marcarDemonstracao('conta financeira', 'contas_correntes', c.id);
      continue;
    }
    if (!c.nome) {
      rel.rejeitar('conta financeira', c.id, 'conta sem nome');
      continue;
    }
    const existente = banco?.contasPorNome.get(chaveDeNome(c.nome));
    if (existente) {
      contaPorFeegow.set(c.id, existente);
      ctx.ledger.registrar(LEDGER_CONTA_FINANCEIRA, c.id, existente.id);
      rel.avisar(
        'conta financeira',
        c.id,
        `a conta "${c.nome}" já existe na Inexci: reaproveitada`,
      );
      continue;
    }
    const id = ctx.novoId();
    const agora = new Date();
    contas.push({
      id,
      ownerId: ctx.ownerId,
      name: c.nome,
      type: c.tipo,
      active: c.ativa,
      notes: null,
      createdById: ctx.ownerId,
      createdAt: agora,
      updatedAt: agora,
    });
    contaPorFeegow.set(c.id, { id, type: c.tipo, active: c.ativa });
    ctx.ledger.registrar(LEDGER_CONTA_FINANCEIRA, c.id, id);
    rel.aceitar('conta financeira');
  }

  const { novas: formasNovas, atualizadas: formasAtualizadas } = planejarFormas(
    exp,
    ctx,
    contaPorFeegow,
  );

  const caixas = new Map<string, CaixaPlanejado>();
  for (const c of modelo.caixas) {
    if (c.demo) {
      marcarDemonstracao('caixa', 'caixas', c.id);
      continue;
    }
    const conta = c.conta ? contaPorFeegow.get(c.conta) : undefined;
    if (!conta) {
      rel.rejeitar('caixa', c.id, 'conta do caixa não migrada');
      continue;
    }
    if (!c.abertura) {
      rel.rejeitar('caixa', c.id, 'data de abertura inválida');
      continue;
    }
    let userId = autor(c.usuario);
    if (!userId) {
      userId = ctx.ownerId;
      rel.avisar(
        'caixa',
        c.id,
        'usuário do caixa não importado: caixa atribuído ao dono da conta',
      );
    }
    const id = ctx.novoId();
    caixas.set(c.id, {
      lido: c,
      saldo: 0,
      fechamento: null,
      novo: {
        id,
        ownerId: ctx.ownerId,
        userId,
        accountId: conta.id,
        openedAt: c.abertura,
        closedAt: c.fechamento ?? c.abertura,
        openingAmount: '0.00',
        countedAmount: '0.00',
        expectedAmount: '0.00',
        difference: '0.00',
        notes: null,
        closedById: c.fechamento ? userId : null,
        createdById: userId,
        createdAt: c.abertura,
        updatedAt: c.fechamento ?? c.abertura,
      },
    });
    ctx.ledger.registrar(LEDGER_CAIXA, c.id, id);
    rel.aceitar('caixa');
  }

  const pacientesDoExport = new Map(
    exp.tabela('pacientes').map((p) => [p.id ?? '', p]),
  );
  const consultasUsadas = new Set(banco?.consultasComCobranca ?? []);
  const cobrancas: NovaCobranca[] = [];
  const itens: NovoItemDeCobranca[] = [];
  const cobrancaPorConta = new Map<string, NovaCobranca>();
  for (const c of modelo.cobrancas.values()) {
    if (c.demo) {
      marcarDemonstracao('cobrança', 'contas', c.id, c.total);
      continue;
    }
    if (c.motivoDeFora) {
      rel.rejeitar('cobrança', c.id, c.motivoDeFora);
      continue;
    }
    const patientId = resolverPaciente(
      c,
      ctx,
      banco,
      pacientesDoExport.get(c.paciente ?? ''),
    );
    if (!patientId) continue;

    const id = ctx.novoId();
    const criadaEm = c.criadaEm ?? new Date();
    const consultasDosItens = new Set<string>();
    for (const i of c.itens) {
      const appointmentId = i.agendamento
        ? ctx.ledger.resolver(LEDGER_CONSULTA, i.agendamento)
        : null;
      if (i.agendamento && !appointmentId) {
        rel.avisar(
          'item de cobrança',
          i.id,
          'consulta fora do ledger: item entra sem consulta, com data e nome preservados',
        );
      }
      if (appointmentId && !i.canceladoEm) consultasDosItens.add(appointmentId);
      const executedById = i.executante
        ? ctx.ledger.resolver(LEDGER_PROFISSIONAL, i.executante)
        : null;
      if (i.executante && !executedById) {
        rel.avisar(
          'item de cobrança',
          i.id,
          'profissional executante não importado: item sem executante',
        );
      }
      const itemId = ctx.novoId();
      itens.push({
        id: itemId,
        ownerId: ctx.ownerId,
        receivableId: id,
        appointmentId,
        description: i.descricao,
        executedById,
        executedAt: i.executadoEm,
        quantity: i.quantidade,
        unitAmount: deCentavos(i.unitario),
        discount: deCentavos(i.desconto),
        surcharge: deCentavos(i.acrescimo),
        total: deCentavos(i.total),
        cancelledAt: i.canceladoEm,
        createdById: autor(c.autor),
        createdAt: criadaEm,
        updatedAt: i.canceladoEm ?? criadaEm,
      });
      ctx.ledger.registrar(LEDGER_ITEM_DE_COBRANCA, i.id, itemId);
      rel.aceitar('item de cobrança');
    }

    let appointmentId: string | null = null;
    if (consultasDosItens.size === 1) {
      const [unica] = consultasDosItens;
      if (consultasUsadas.has(unica)) {
        rel.avisar(
          'cobrança',
          c.id,
          'a consulta já tem outra cobrança ativa: cobrança entra sem consulta de origem',
        );
      } else {
        appointmentId = unica;
        consultasUsadas.add(unica);
      }
    }

    const nova: NovaCobranca = {
      id,
      ownerId: ctx.ownerId,
      patientId,
      appointmentId,
      referenceDate: c.referencia!,
      dueDate: c.vencimento,
      totalAmount: deCentavos(c.total),
      paidAmount: '0.00',
      status: ReceivableStatus.OPEN,
      notes: null,
      createdById: autor(c.autor),
      createdAt: criadaEm,
      updatedAt: criadaEm,
    };
    cobrancas.push(nova);
    cobrancaPorConta.set(c.id, nova);
    ctx.ledger.registrar(LEDGER_COBRANCA, c.id, id);
    rel.aceitar('cobrança');
  }

  const cartoes = new Map(
    exp.tabela('transacao_cartao').map((t) => [t.movimentacao_id ?? '', t]),
  );
  const bandeiras = new Map(
    exp
      .tabela('bandeiras_cartao')
      .map((b): [string, string] => [b.id ?? '', b.Bandeira ?? '']),
  );
  const lancamentos: NovoLancamento[] = [];
  const contrapartidas: [string, string][] = [];
  const lancar = (
    chave: string,
    destino: Destino,
    dados: Omit<
      NovoLancamento,
      | 'id'
      | 'ownerId'
      | 'accountId'
      | 'cashSessionId'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): NovoLancamento => {
    const l: NovoLancamento = {
      id: ctx.novoId(),
      ownerId: ctx.ownerId,
      accountId: destino.cashSessionId ? null : destino.accountId,
      cashSessionId: destino.cashSessionId,
      ...dados,
      createdAt: dados.occurredAt,
      updatedAt: dados.occurredAt,
    };
    lancamentos.push(l);
    ctx.ledger.registrar(LEDGER_LANCAMENTO, chave, l.id);
    rel.aceitar('lançamento');
    return l;
  };
  const destinoDoLado = (l: Lado): Destino | null => {
    if (l.associacao === ASSOCIACAO_CAIXA && l.id) {
      const caixa = caixas.get(l.id);
      return caixa ? { accountId: null, cashSessionId: caixa.novo.id } : null;
    }
    if (l.associacao === ASSOCIACAO_CONTA_CORRENTE && l.id) {
      const conta = contaPorFeegow.get(l.id);
      return conta ? { accountId: conta.id, cashSessionId: null } : null;
    }
    return null;
  };
  const movimentarCaixa = (destino: Destino, valor: number) => {
    if (!destino.cashSessionId) return;
    for (const c of caixas.values()) {
      if (c.novo.id === destino.cashSessionId) c.saldo += valor;
    }
  };

  const pagamentos: NovoPagamento[] = [];
  const pagamentoPorFeegow = new Map<
    string,
    { novo: NovoPagamento; entrada: Destino }
  >();
  const pagamentosComNota: {
    movimentacao: string;
    forma: string | null;
    data: string;
    valor: string;
  }[] = [];
  for (const p of modelo.pagamentos) {
    if (p.demo) {
      marcarDemonstracao('pagamento', 'movimentacao', p.id, p.valor);
      continue;
    }
    if (p.motivoDeFora) {
      rel.rejeitar('pagamento', p.id, p.motivoDeFora);
      continue;
    }
    const cobranca = p.conta ? cobrancaPorConta.get(p.conta) : undefined;
    if (!cobranca) {
      rel.rejeitar('pagamento', p.id, 'cobrança do pagamento não migrada');
      continue;
    }
    let entrada: Destino | null = null;
    let accountId: string | null = null;
    if (p.destino.associacao === ASSOCIACAO_CAIXA) {
      const caixa = p.destino.id ? caixas.get(p.destino.id) : undefined;
      if (caixa) {
        entrada = { accountId: null, cashSessionId: caixa.novo.id };
        accountId = caixa.novo.accountId;
      }
    } else {
      entrada = destinoDoLado(p.destino);
      accountId = entrada?.accountId ?? null;
    }
    if (!entrada) {
      rel.rejeitar(
        'pagamento',
        p.id,
        'destino do pagamento (conta ou caixa) não migrado',
      );
      continue;
    }
    if (!p.forma.conhecida) {
      rel.avisar(
        'pagamento',
        p.id,
        `forma de pagamento ${p.formaId ?? '(vazia)'} desconhecida: entra como "outro"`,
      );
    }
    const cashSessionId =
      entrada.cashSessionId ??
      (p.caixa ? (caixas.get(p.caixa)?.novo.id ?? null) : null);
    const cartao = cartoes.get(p.id);
    const credito = p.forma.metodo === PaymentMethod.CREDIT_CARD;
    const id = ctx.novoId();
    const pagoEm = p.pagoEm!;
    const novo: NovoPagamento = {
      id,
      ownerId: ctx.ownerId,
      receivableId: cobranca.id,
      method: p.forma.metodo,
      amount: deCentavos(p.valor),
      refundedAmount: deCentavos(p.estornado),
      paidAt: pagoEm,
      accountId,
      cashSessionId,
      receivedById: autor(p.autor),
      cardBrand: cartao
        ? bandeiraDoCartao(cartao.bandeira_cartao_id, bandeiras)
        : null,
      installments: credito && cartao ? parcelasDoCartao(cartao.parcelas) : 1,
      nsu: cartao ? normalizarTexto(cartao.numero_transacao, 40) : null,
      authorizationCode: cartao
        ? normalizarTexto(cartao.numero_autorizacao, 40)
        : null,
      notes: p.forma.nota,
      createdById: autor(p.autor),
      createdAt: pagoEm,
      updatedAt: pagoEm,
    };
    pagamentos.push(novo);
    pagamentoPorFeegow.set(p.id, { novo, entrada });
    ctx.ledger.registrar(LEDGER_PAGAMENTO, p.id, id);
    rel.aceitar('pagamento');
    if (p.forma.nota) {
      pagamentosComNota.push({
        movimentacao: p.id,
        forma: p.formaId,
        data: pagoEm.toISOString(),
        valor: novo.amount,
      });
    }
    lancar(`pagamento:${p.id}`, entrada, {
      direction: FinancialEntryDirection.IN,
      kind: FinancialEntryKind.PAYMENT,
      amount: novo.amount,
      paymentId: id,
      refundId: null,
      occurredAt: pagoEm,
      description: null,
      createdById: novo.receivedById,
    });
    movimentarCaixa(entrada, p.valor);
  }

  const estornos: NovoEstorno[] = [];
  for (const d of modelo.devolucoesDeFora) {
    if (d.demo) marcarDemonstracao('estorno', 'devolucoes', d.id);
    else rel.rejeitar('estorno', d.id, d.motivo);
  }
  for (const s of modelo.sobrasDeDevolucao) {
    rel.avisar(
      'estorno',
      s.devolucao,
      `devolução maior que o recebido: R$ ${deCentavos(s.valor)} sem pagamento para estornar`,
    );
  }
  for (const e of modelo.estornos) {
    const pagamento = pagamentoPorFeegow.get(e.pagamento.id);
    if (!pagamento) {
      rel.rejeitar('estorno', e.chave, 'pagamento estornado não migrado');
      continue;
    }
    const contaDaDevolucao = e.contaCorrente
      ? contaPorFeegow.get(e.contaCorrente)
      : undefined;
    const saida: Destino = contaDaDevolucao
      ? { accountId: contaDaDevolucao.id, cashSessionId: null }
      : pagamento.entrada;
    const em = e.em ?? pagamento.novo.paidAt;
    const id = ctx.novoId();
    const novo: NovoEstorno = {
      id,
      ownerId: ctx.ownerId,
      paymentId: pagamento.novo.id,
      amount: deCentavos(e.valor),
      reason: e.motivo,
      notes: e.notas,
      accountId: saida.cashSessionId ? null : saida.accountId,
      cashSessionId: saida.cashSessionId,
      refundedById: autor(e.autor),
      createdById: autor(e.autor),
      createdAt: em,
      updatedAt: em,
    };
    estornos.push(novo);
    ctx.ledger.registrar(LEDGER_ESTORNO, e.chave, id);
    rel.aceitar('estorno');
    lancar(`estorno:${e.chave}`, saida, {
      direction: FinancialEntryDirection.OUT,
      kind: FinancialEntryKind.REFUND,
      amount: novo.amount,
      paymentId: pagamento.novo.id,
      refundId: id,
      occurredAt: em,
      description: null,
      createdById: novo.refundedById,
    });
    movimentarCaixa(saida, -e.valor);
  }

  let transferenciasDePaciente = 0;
  for (const t of modelo.transferencias) {
    if (t.demo) {
      marcarDemonstracao('lançamento', 'movimentacao', t.id, t.valor);
      continue;
    }
    if (t.tipo === 'paciente') {
      transferenciasDePaciente++;
      rel.avisar(
        'lançamento',
        t.id,
        'movimento na conta do paciente (cancelamento ou devolução): representado pelo item cancelado e pelo estorno',
      );
      continue;
    }
    if (t.valor === null || !t.em) {
      rel.rejeitar('lançamento', t.id, 'valor ou data inválidos');
      continue;
    }
    const createdById = autor(t.autor);
    if (t.tipo === 'fechamento') {
      const caixa = t.credito.id ? caixas.get(t.credito.id) : undefined;
      if (!caixa) {
        rel.rejeitar('lançamento', t.id, 'caixa do fechamento não migrado');
        continue;
      }
      caixa.fechamento = (caixa.fechamento ?? 0) + t.valor;
      if (t.valor <= 0) continue;
      const saida = lancar(
        `fechamento:${t.id}:saida`,
        { accountId: null, cashSessionId: caixa.novo.id },
        {
          direction: FinancialEntryDirection.OUT,
          kind: FinancialEntryKind.SESSION_CLOSING,
          amount: deCentavos(t.valor),
          paymentId: null,
          refundId: null,
          occurredAt: t.em,
          description: t.descricao,
          createdById,
        },
      );
      caixa.saldo -= t.valor;
      const destino = destinoDoLado(t.debito);
      if (destino && !destino.cashSessionId) {
        const entrada = lancar(`fechamento:${t.id}:entrada`, destino, {
          direction: FinancialEntryDirection.IN,
          kind: FinancialEntryKind.SESSION_CLOSING,
          amount: deCentavos(t.valor),
          paymentId: null,
          refundId: null,
          occurredAt: t.em,
          description: t.descricao,
          createdById,
        });
        contrapartidas.push([saida.id, entrada.id], [entrada.id, saida.id]);
      } else {
        rel.avisar(
          'lançamento',
          t.id,
          'conta de destino do fechamento não migrada: só a saída do caixa foi lançada',
        );
      }
      continue;
    }
    if (t.valor <= 0) {
      rel.rejeitar('lançamento', t.id, 'lançamento de valor zero');
      continue;
    }
    const origem = destinoDoLado(t.credito);
    const destino = destinoDoLado(t.debito);
    if (!origem && !destino) {
      rel.rejeitar(
        'lançamento',
        t.id,
        'lançamento sem conta ou caixa migrados dos dois lados',
      );
      continue;
    }
    const kindDaSaida =
      t.tipo === 'retirada'
        ? FinancialEntryKind.WITHDRAWAL
        : FinancialEntryKind.ADJUSTMENT;
    const kindDaEntrada =
      t.tipo === 'retirada'
        ? FinancialEntryKind.TRANSFER
        : FinancialEntryKind.ADJUSTMENT;
    const base = {
      amount: deCentavos(t.valor),
      paymentId: null,
      refundId: null,
      occurredAt: t.em,
      description: t.descricao,
      createdById,
    };
    const saida = origem
      ? lancar(`lancamento:${t.id}:saida`, origem, {
          ...base,
          direction: FinancialEntryDirection.OUT,
          kind: kindDaSaida,
        })
      : null;
    if (origem) movimentarCaixa(origem, -t.valor);
    const entrada = destino
      ? lancar(`lancamento:${t.id}:entrada`, destino, {
          ...base,
          direction: FinancialEntryDirection.IN,
          kind: kindDaEntrada,
        })
      : null;
    if (destino) movimentarCaixa(destino, t.valor);
    if (saida && entrada) {
      contrapartidas.push([saida.id, entrada.id], [entrada.id, saida.id]);
    } else {
      rel.avisar(
        'lançamento',
        t.id,
        'só um lado do lançamento tem conta ou caixa migrados',
      );
    }
  }

  const caixasFechadosNaMigracao: {
    caixa: string;
    abertoEm: string;
    fechadoEm: string;
    saldoEmDinheiro: string;
  }[] = [];
  for (const [idFeegow, c] of caixas) {
    if (!c.lido.fechamento) {
      const fechadoEm =
        c.lido.ultimoMovimento && c.lido.ultimoMovimento > c.novo.openedAt
          ? c.lido.ultimoMovimento
          : c.novo.openedAt;
      const saldo = Math.max(c.saldo, 0);
      c.novo.closedAt = fechadoEm;
      c.novo.updatedAt = fechadoEm;
      c.novo.notes = NOTA_FECHADO_NA_MIGRACAO;
      c.novo.closedById = null;
      c.novo.countedAmount = deCentavos(saldo);
      c.novo.expectedAmount = deCentavos(saldo);
      caixasFechadosNaMigracao.push({
        caixa: idFeegow,
        abertoEm: c.novo.openedAt.toISOString(),
        fechadoEm: fechadoEm.toISOString(),
        saldoEmDinheiro: deCentavos(c.saldo),
      });
      rel.avisar(
        'caixa',
        idFeegow,
        'caixa aberto no export: entra fechado no último movimento (D4)',
      );
      continue;
    }
    const contado = c.fechamento ?? Math.max(c.saldo, 0);
    c.novo.countedAmount = deCentavos(contado);
    c.novo.expectedAmount = deCentavos(contado);
    if (c.saldo !== 0) {
      rel.avisar(
        'caixa',
        idFeegow,
        c.fechamento === null
          ? `caixa fechado sem "Fechamento Cx": R$ ${deCentavos(c.saldo)} em dinheiro ficam no caixa`
          : `dinheiro do caixa difere do fechamento em R$ ${deCentavos(c.saldo)}`,
      );
    }
  }

  for (const cobranca of cobrancas) {
    const pago = pagamentos
      .filter((p) => p.receivableId === cobranca.id)
      .reduce(
        (s, p) => s + paraCentavos(p.amount) - paraCentavos(p.refundedAmount),
        0,
      );
    const liquido = pago;
    cobranca.paidAmount = deCentavos(liquido);
    cobranca.status = statusDaCobranca({
      totalAmount: cobranca.totalAmount,
      paidAmount: cobranca.paidAmount,
    });
    if (liquido > paraCentavos(cobranca.totalAmount)) {
      rel.avisar(
        'cobrança',
        cobranca.id,
        `recebido acima do total da cobrança (total R$ ${cobranca.totalAmount}, recebido R$ ${cobranca.paidAmount})`,
      );
    }
  }

  const precos = planejarPrecos(exp, ctx);

  const resumoDoExportCalculado = resumoDoExport(modelo);
  const resumoDoPlano = resumirPlano(pagamentos, estornos, cobrancas);
  const contaPorCobranca = new Map(
    [...cobrancaPorConta].map(([conta, c]) => [c.id, conta]),
  );
  Object.assign(rel.extras, {
    contagensDoExport: contagensDoExport(exp),
    rejeicoesPorRegra: Object.fromEntries(
      rel.rejeicoes.reduce((m, r) => {
        const k = `${r.entidade} — ${r.motivo}`;
        return m.set(k, (m.get(k) ?? 0) + 1);
      }, new Map<string, number>()),
    ),
    cobrancasEmAberto: cobrancas
      .filter(
        (c) =>
          c.status === ReceivableStatus.OPEN ||
          c.status === ReceivableStatus.PARTIAL,
      )
      .map((c) => ({
        conta: contaPorCobranca.get(c.id),
        cobranca: c.id,
        status: c.status,
        dataDeReferencia: c.referenceDate,
        vencimento: c.dueDate,
        total: c.totalAmount,
        recebido: c.paidAmount,
        saldo: deCentavos(
          paraCentavos(c.totalAmount) - paraCentavos(c.paidAmount),
        ),
      })),
    caixasFechadosNaMigracao,
    pagamentosComFormaDoCliente: pagamentosComNota,
    transferenciasDePaciente,
    demonstracao,
    naoMigrados: {
      movimentacao_removidos: exp.tabela('movimentacao_removidos').length,
      conta_itens_cancelados: exp.tabela('conta_itens_cancelados').length,
    },
    precosDeConsulta: precos.length,
    somas: compararSomas(resumoDoExportCalculado, resumoDoPlano),
  });

  return {
    contas,
    formasNovas,
    formasAtualizadas,
    caixas: [...caixas.values()].map((c) => c.novo),
    cobrancas,
    itens,
    pagamentos,
    estornos,
    lancamentos,
    contrapartidas,
    precos,
    resumoDoExport: resumoDoExportCalculado,
    resumoDoPlano,
  };
}

function resolverPaciente(
  c: CobrancaLida,
  ctx: ContextoImportacao,
  banco: DadosFinanceirosDoBanco | null,
  pacienteDoExport: LinhaCsv | undefined,
): string | null {
  const rel = ctx.relatorio;
  const doLedger = ctx.ledger.resolver(LEDGER_PACIENTE, c.paciente);
  if (doLedger) return doLedger;
  const cpf = normalizarCpf(pacienteDoExport?.cpf);
  if (!cpf) {
    rel.rejeitar(
      'cobrança',
      c.id,
      'paciente fora do ledger e sem CPF válido (D2): lançar à mão',
    );
    return null;
  }
  if (!banco) {
    rel.rejeitar(
      'cobrança',
      c.id,
      'paciente fora do ledger (sem banco: CPF não conferido)',
    );
    return null;
  }
  const candidatos = banco.pacientesPorCpf.get(cpf) ?? [];
  if (candidatos.length !== 1) {
    rel.rejeitar(
      'cobrança',
      c.id,
      candidatos.length
        ? 'paciente fora do ledger com CPF repetido no tenant (D2): lançar à mão'
        : 'paciente fora do ledger e CPF não encontrado no tenant (D2): lançar à mão',
    );
    return null;
  }
  rel.avisar('cobrança', c.id, 'paciente fora do ledger casado pelo CPF (D2)');
  return candidatos[0];
}

function planejarFormas(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
  contaPorFeegow: Map<
    string,
    { id: string; type: FinancialAccountType; active: boolean }
  >,
): { novas: NovaConfiguracaoDeForma[]; atualizadas: AtualizacaoDeForma[] } {
  const porMetodo = new Map<
    PaymentMethod,
    { conta: string | null; parcelas: number }
  >();
  for (const f of exp.tabela('formas_recebimentos')) {
    const forma = formaDePagamento(f.MetodoID);
    if (!forma.conhecida) {
      ctx.relatorio.avisar(
        'forma de pagamento',
        f.id ?? '',
        `regra de recebimento com forma ${f.MetodoID ?? '(vazia)'} desconhecida: ignorada`,
      );
      continue;
    }
    const contas = listaDeIds(f.Contas)
      .filter((id) => id.toUpperCase() !== 'ALL')
      .map((id) => contaPorFeegow.get(id))
      .filter(
        (c): c is { id: string; type: FinancialAccountType; active: boolean } =>
          !!c && c.active,
      );
    const atual = porMetodo.get(forma.metodo) ?? { conta: null, parcelas: 1 };
    const parcelas = Number(f.ParcelasAte);
    porMetodo.set(forma.metodo, {
      conta: atual.conta ?? (contas.length === 1 ? contas[0].id : null),
      parcelas: Math.max(
        atual.parcelas,
        Number.isInteger(parcelas) ? parcelas : 1,
      ),
    });
  }

  const novas: NovaConfiguracaoDeForma[] = [];
  const atualizadas: AtualizacaoDeForma[] = [];
  for (const [metodo, regra] of porMetodo) {
    const parcelas =
      metodo === PaymentMethod.CREDIT_CARD
        ? Math.min(Math.max(regra.parcelas, 1), MAX_INSTALLMENTS_LIMIT)
        : 1;
    const existente = ctx.financeiro?.formas.get(metodo);
    if (!existente) {
      const id = ctx.novoId();
      novas.push({
        id,
        ownerId: ctx.ownerId,
        method: metodo,
        active: true,
        defaultAccountId: regra.conta,
        maxInstallments: parcelas,
        createdById: ctx.ownerId,
      });
      ctx.ledger.registrar(LEDGER_FORMA_DE_PAGAMENTO, metodo, id);
      ctx.relatorio.aceitar('forma de pagamento');
      continue;
    }
    const mudanca: AtualizacaoDeForma = { id: existente.id, method: metodo };
    if (!existente.defaultAccountId && regra.conta) {
      mudanca.defaultAccountId = regra.conta;
    }
    if (existente.maxInstallments === 1 && parcelas > 1) {
      mudanca.maxInstallments = parcelas;
    }
    if (
      mudanca.defaultAccountId === undefined &&
      mudanca.maxInstallments === undefined
    ) {
      ctx.relatorio.pular('forma de pagamento');
      continue;
    }
    atualizadas.push(mudanca);
    ctx.ledger.registrar(LEDGER_FORMA_DE_PAGAMENTO, metodo, existente.id);
    ctx.relatorio.aceitar('forma de pagamento');
  }
  return { novas, atualizadas };
}

function planejarPrecos(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoPrecoDeConsulta[] {
  const precos: NovoPrecoDeConsulta[] = [];
  for (const a of exp.tabela('agendamentos')) {
    const valor = centavos(a.valor);
    if (valor === null || valor <= 0) continue;
    const appointmentId = ctx.ledger.resolver(LEDGER_CONSULTA, a.id);
    if (!appointmentId) continue;
    precos.push({
      agendamento: a.id ?? '',
      appointmentId,
      price: deCentavos(valor),
    });
    ctx.ledger.registrar(LEDGER_PRECO_DA_CONSULTA, a.id ?? '', appointmentId);
  }
  ctx.relatorio.aceitar('valor previsto da consulta', precos.length);
  return precos;
}

function resumirPlano(
  pagamentos: NovoPagamento[],
  estornos: NovoEstorno[],
  cobrancas: NovaCobranca[],
): ResumoFinanceiro {
  const somas: SomasFinanceiras = { porAno: {}, porForma: {} };
  const anoSp = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
    }).format(d);
  const metodoPorPagamento = new Map(pagamentos.map((p) => [p.id, p.method]));
  for (const p of pagamentos) {
    acumular(somas.porAno, anoSp(p.paidAt), paraCentavos(p.amount));
    acumular(somas.porForma, p.method, paraCentavos(p.amount));
  }
  for (const e of estornos) {
    acumular(somas.porAno, anoSp(e.createdAt), -paraCentavos(e.amount));
    acumular(
      somas.porForma,
      metodoPorPagamento.get(e.paymentId) ?? PaymentMethod.OTHER,
      -paraCentavos(e.amount),
    );
  }
  return {
    somas,
    abertas: cobrancas.filter((c) => c.status === ReceivableStatus.OPEN).length,
    parciais: cobrancas.filter((c) => c.status === ReceivableStatus.PARTIAL)
      .length,
  };
}

export function compararSomas(
  esperado: ResumoFinanceiro,
  obtido: ResumoFinanceiro,
  rotuloObtido = 'migrado',
) {
  const tabela = (
    a: Record<string, number>,
    b: Record<string, number>,
  ): Record<string, Record<string, string>> =>
    Object.fromEntries(
      [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map((k) => [
        k,
        {
          export: deCentavos(a[k] ?? 0),
          [rotuloObtido]: deCentavos(b[k] ?? 0),
          diferenca: deCentavos((a[k] ?? 0) - (b[k] ?? 0)),
        },
      ]),
    );
  return {
    porAno: tabela(esperado.somas.porAno, obtido.somas.porAno),
    porForma: tabela(esperado.somas.porForma, obtido.somas.porForma),
    abertas: { export: esperado.abertas, [rotuloObtido]: obtido.abertas },
    parciais: { export: esperado.parciais, [rotuloObtido]: obtido.parciais },
  };
}

function contagensDoExport(exp: ExportFeegow): Record<string, number> {
  const movimentacao = exp.tabela('movimentacao');
  const contagem: Record<string, number> = {};
  for (const tabela of [
    'contas',
    'conta_itens',
    'pagamento_associacao',
    'pagamento_item_associacao',
    'transacao_cartao',
    'caixas',
    'contas_correntes',
    'formas_pagamento',
    'formas_recebimentos',
    'devolucoes',
    'motivo_devolucao',
  ]) {
    contagem[tabela] = exp.tabela(tabela).length;
  }
  for (const tipo of ['Bill', 'Pay', 'Transfer']) {
    contagem[`movimentacao:${tipo}`] = movimentacao.filter(
      (m) => m.tipo_movimentacao === tipo,
    ).length;
  }
  return contagem;
}
