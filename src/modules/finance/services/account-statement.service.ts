import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { FinancialAccountRepository } from 'src/database/repositories/financial-account.repository';
import {
  FinanceReportsRepository,
  FUSO_DOS_RELATORIOS,
  PeriodoDeDatas,
} from 'src/database/repositories/finance-reports.repository';
import { AccountStatementDto } from '../dto/account-statement.dto';
import { normalizarValor } from '../utils/dinheiro';
import { gerarCsv, valorCsv } from '../utils/csv';
import { assertPeriodoValido } from './finance-reports.service';

export const ROTULO_DO_TIPO_DE_LANCAMENTO: Record<FinancialEntryKind, string> =
  {
    [FinancialEntryKind.PAYMENT]: 'Recebimento',
    [FinancialEntryKind.REFUND]: 'Estorno',
    [FinancialEntryKind.WITHDRAWAL]: 'Sangria',
    [FinancialEntryKind.SUPPLY]: 'Suprimento',
    [FinancialEntryKind.SESSION_CLOSING]: 'Fechamento de caixa',
    [FinancialEntryKind.TRANSFER]: 'Transferência',
    [FinancialEntryKind.ADJUSTMENT]: 'Ajuste',
  };

const formatoDeDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_DOS_RELATORIOS,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function dataHoraEmSaoPaulo(instante: Date | string): string {
  return formatoDeDataHora.format(new Date(instante)).replace(',', '');
}

@Injectable()
export class AccountStatementService {
  constructor(
    private readonly accountRepository: FinancialAccountRepository,
    private readonly reportsRepository: FinanceReportsRepository,
  ) {}

  async statement(
    ownerId: string,
    accountId: string,
    periodo: PeriodoDeDatas,
  ): Promise<AccountStatementDto> {
    assertPeriodoValido(periodo);
    const account = await this.accountRepository.findOwned(accountId, ownerId);
    if (!account) throw new NotFoundException('Conta não encontrada');

    const [saldos, movimentos] = await Promise.all([
      this.reportsRepository.saldosDoExtrato(ownerId, accountId, periodo),
      this.reportsRepository.movimentosDoExtrato(ownerId, accountId, periodo),
    ]);

    return {
      account: { id: account.id, name: account.name, type: account.type },
      openingBalance: normalizarValor(saldos.saldoInicial),
      closingBalance: normalizarValor(saldos.saldoFinal),
      entries: movimentos.map((movimento) => ({
        id: movimento.id,
        occurredAt: new Date(movimento.occurredAt),
        direction: movimento.direction as FinancialEntryDirection,
        kind: movimento.kind as FinancialEntryKind,
        amount: normalizarValor(movimento.amount),
        description: movimento.description,
        balance: normalizarValor(movimento.balance),
      })),
    };
  }

  statementCsv(extrato: AccountStatementDto): string {
    return gerarCsv(
      ['Data', 'Tipo', 'Descrição', 'Entrada', 'Saída', 'Saldo'],
      [
        ['', 'Saldo inicial', '', '', '', valorCsv(extrato.openingBalance)],
        ...extrato.entries.map((entry) => {
          const entrada = entry.direction === FinancialEntryDirection.IN;
          return [
            dataHoraEmSaoPaulo(entry.occurredAt),
            ROTULO_DO_TIPO_DE_LANCAMENTO[entry.kind] ?? entry.kind,
            entry.description ?? '',
            entrada ? valorCsv(entry.amount) : '',
            entrada ? '' : valorCsv(entry.amount),
            valorCsv(entry.balance),
          ];
        }),
        ['', 'Saldo final', '', '', '', valorCsv(extrato.closingBalance)],
      ],
    );
  }
}
