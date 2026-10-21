import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import {
  AgrupamentoDeRecebimentos,
  FinanceReportsRepository,
  FUSO_DOS_RELATORIOS,
  LinhaDeRecebimentos,
  PeriodoDeDatas,
} from 'src/database/repositories/finance-reports.repository';
import { formatDateBR } from 'src/shared/utils';
import {
  OpenReportDto,
  OpenReportQueryDto,
  ProductionReportDto,
  ReceiptsReportDto,
  ReceiptsReportRowDto,
} from '../dto/finance-report.dto';
import { normalizarValor, somar, subtrair } from '../utils/dinheiro';
import { gerarCsv, valorCsv } from '../utils/csv';

export const ROTULO_DA_FORMA: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Dinheiro',
  [PaymentMethod.PIX]: 'PIX',
  [PaymentMethod.CREDIT_CARD]: 'Cartão de crédito',
  [PaymentMethod.DEBIT_CARD]: 'Cartão de débito',
  [PaymentMethod.BANK_TRANSFER]: 'Transferência bancária',
  [PaymentMethod.BOLETO]: 'Boleto',
  [PaymentMethod.CHECK]: 'Cheque',
  [PaymentMethod.OTHER]: 'Outra',
};

export function rotuloDaForma(metodo: string | null | undefined): string {
  if (!metodo) return 'Não informada';
  return ROTULO_DA_FORMA[metodo as PaymentMethod] ?? metodo;
}

export function diaEmSaoPaulo(instante: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DOS_RELATORIOS,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

export function assertPeriodoValido(periodo: PeriodoDeDatas): void {
  if (periodo.from > periodo.to) {
    throw new BadRequestException(
      'A data inicial não pode ser posterior à data final',
    );
  }
}

const CABECALHO_DO_AGRUPAMENTO: Record<AgrupamentoDeRecebimentos, string> = {
  day: 'Dia',
  month: 'Mês',
  method: 'Forma de pagamento',
  account: 'Conta',
  user: 'Recebido por',
};

export function rotuloDoGrupo(
  agrupamento: AgrupamentoDeRecebimentos,
  linha: Pick<LinhaDeRecebimentos, 'chave' | 'nome'>,
): string {
  switch (agrupamento) {
    case 'day':
      return linha.chave ? formatDateBR(linha.chave) : 'Sem data';
    case 'month': {
      const partes = linha.chave?.split('-');
      return partes?.length === 2 ? `${partes[1]}/${partes[0]}` : 'Sem data';
    }
    case 'method':
      return rotuloDaForma(linha.chave);
    case 'account':
      return linha.nome ?? 'Sem conta';
    case 'user':
      return linha.nome ?? 'Não informado';
  }
}

@Injectable()
export class FinanceReportsService {
  constructor(private readonly reportsRepository: FinanceReportsRepository) {}

  async receipts(
    ownerId: string,
    periodo: PeriodoDeDatas,
    agrupamento: AgrupamentoDeRecebimentos,
  ): Promise<ReceiptsReportDto> {
    assertPeriodoValido(periodo);
    const linhas = await this.reportsRepository.recebimentos(
      ownerId,
      periodo,
      agrupamento,
    );

    const rows: ReceiptsReportRowDto[] = linhas.map((linha) => ({
      key: linha.chave,
      label: rotuloDoGrupo(agrupamento, linha),
      received: normalizarValor(linha.recebido),
      refunded: normalizarValor(linha.estornado),
      net: subtrair(linha.recebido, linha.estornado),
      count: Number(linha.quantidade),
    }));

    const received = somar(...rows.map((row) => row.received));
    const refunded = somar(...rows.map((row) => row.refunded));
    return {
      groupBy: agrupamento,
      rows,
      totals: {
        received,
        refunded,
        net: subtrair(received, refunded),
        count: rows.reduce((total, row) => total + row.count, 0),
      },
    };
  }

  receiptsCsv(relatorio: ReceiptsReportDto): string {
    return gerarCsv(
      [
        CABECALHO_DO_AGRUPAMENTO[relatorio.groupBy],
        'Recebido',
        'Estornado',
        'Líquido',
        'Quantidade',
      ],
      [
        ...relatorio.rows.map((row) => [
          row.label,
          valorCsv(row.received),
          valorCsv(row.refunded),
          valorCsv(row.net),
          row.count,
        ]),
        [
          'Total',
          valorCsv(relatorio.totals.received),
          valorCsv(relatorio.totals.refunded),
          valorCsv(relatorio.totals.net),
          relatorio.totals.count,
        ],
      ],
    );
  }

  async production(
    ownerId: string,
    periodo: PeriodoDeDatas,
  ): Promise<ProductionReportDto> {
    assertPeriodoValido(periodo);
    const linhas = await this.reportsRepository.producao(ownerId, periodo);

    const rows = linhas.map((linha) => ({
      executedById: linha.executedById,
      name: linha.nome ?? 'Sem profissional',
      items: Number(linha.itens),
      billed: normalizarValor(linha.faturado),
      received: normalizarValor(linha.recebido),
    }));

    return {
      rows,
      totals: {
        items: rows.reduce((total, row) => total + row.items, 0),
        billed: somar(...rows.map((row) => row.billed)),
        received: somar(...rows.map((row) => row.received)),
      },
    };
  }

  productionCsv(relatorio: ProductionReportDto): string {
    return gerarCsv(
      ['Profissional', 'Itens', 'Faturado', 'Recebido'],
      [
        ...relatorio.rows.map((row) => [
          row.name,
          row.items,
          valorCsv(row.billed),
          valorCsv(row.received),
        ]),
        [
          'Total',
          relatorio.totals.items,
          valorCsv(relatorio.totals.billed),
          valorCsv(relatorio.totals.received),
        ],
      ],
    );
  }

  async open(
    ownerId: string,
    query: Pick<OpenReportQueryDto, 'until'>,
    agora: Date = new Date(),
  ): Promise<OpenReportDto> {
    const ate = query.until ?? diaEmSaoPaulo(agora);
    const linhas = await this.reportsRepository.emAberto(ownerId, ate);

    const rows = linhas.map((linha) => ({
      receivableId: linha.receivableId,
      patient: { id: linha.patientId, name: linha.patientName },
      referenceDate: linha.referenceDate,
      dueDate: linha.dueDate,
      totalAmount: normalizarValor(linha.totalAmount),
      paidAmount: normalizarValor(linha.paidAmount),
      balance: normalizarValor(linha.balance),
      ageDays: Number(linha.ageDays),
    }));

    return {
      rows,
      totals: {
        count: rows.length,
        balance: somar(...rows.map((row) => row.balance)),
      },
    };
  }

  openCsv(relatorio: OpenReportDto): string {
    return gerarCsv(
      [
        'Paciente',
        'Data de referência',
        'Vencimento',
        'Total',
        'Pago',
        'Saldo',
        'Dias em aberto',
      ],
      [
        ...relatorio.rows.map((row) => [
          row.patient.name,
          formatDateBR(row.referenceDate),
          row.dueDate ? formatDateBR(row.dueDate) : '',
          valorCsv(row.totalAmount),
          valorCsv(row.paidAmount),
          valorCsv(row.balance),
          row.ageDays,
        ]),
        [
          `Total (${relatorio.totals.count})`,
          '',
          '',
          '',
          '',
          valorCsv(relatorio.totals.balance),
          '',
        ],
      ],
    );
  }
}
