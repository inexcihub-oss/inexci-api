import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import { FinancialAccountRepository } from 'src/database/repositories/financial-account.repository';
import { FinanceReportsRepository } from 'src/database/repositories/finance-reports.repository';
import {
  AccountStatementService,
  dataHoraEmSaoPaulo,
} from './account-statement.service';

function montar() {
  const accountRepository = { findOwned: jest.fn() };
  const reportsRepository = {
    saldosDoExtrato: jest.fn(),
    movimentosDoExtrato: jest.fn(),
  };
  const service = new AccountStatementService(
    accountRepository as unknown as FinancialAccountRepository,
    reportsRepository as unknown as FinanceReportsRepository,
  );
  return { accountRepository, reportsRepository, service };
}

const periodo = { from: '2026-10-01', to: '2026-10-31' };

describe('AccountStatementService', () => {
  it('conta de outro tenant responde 404 sem consultar lançamentos', async () => {
    const { accountRepository, reportsRepository, service } = montar();
    accountRepository.findOwned.mockResolvedValue(null);

    await expect(
      service.statement('owner-1', 'conta-x', periodo),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accountRepository.findOwned).toHaveBeenCalledWith(
      'conta-x',
      'owner-1',
    );
    expect(reportsRepository.movimentosDoExtrato).not.toHaveBeenCalled();
  });

  it('recusa período invertido', async () => {
    const { service } = montar();
    await expect(
      service.statement('owner-1', 'c-1', {
        from: '2026-11-01',
        to: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('monta saldo inicial, movimentos com saldo corrente e saldo final', async () => {
    const { accountRepository, reportsRepository, service } = montar();
    accountRepository.findOwned.mockResolvedValue({
      id: 'c-1',
      name: 'Banco',
      type: FinancialAccountType.BANK,
    });
    reportsRepository.saldosDoExtrato.mockResolvedValue({
      saldoInicial: '1000',
      saldoFinal: '1150.00',
    });
    reportsRepository.movimentosDoExtrato.mockResolvedValue([
      {
        id: 'e-1',
        occurredAt: new Date('2026-10-21T02:30:00Z'),
        direction: 'in',
        kind: 'payment',
        amount: '200.00',
        description: 'Consulta',
        balance: '1200.00',
      },
      {
        id: 'e-2',
        occurredAt: '2026-10-22T13:00:00Z',
        direction: 'out',
        kind: 'refund',
        amount: '50.00',
        description: null,
        balance: '1150.00',
      },
    ]);

    const extrato = await service.statement('owner-1', 'c-1', periodo);

    expect(reportsRepository.saldosDoExtrato).toHaveBeenCalledWith(
      'owner-1',
      'c-1',
      periodo,
    );
    expect(extrato.account).toEqual({ id: 'c-1', name: 'Banco', type: 'bank' });
    expect(extrato.openingBalance).toBe('1000.00');
    expect(extrato.closingBalance).toBe('1150.00');
    expect(extrato.entries[1].occurredAt).toBeInstanceOf(Date);

    expect(service.statementCsv(extrato)).toBe(
      'Data;Tipo;Descrição;Entrada;Saída;Saldo\r\n' +
        ';Saldo inicial;;;;1000,00\r\n' +
        '20/10/2026 23:30;Recebimento;Consulta;200,00;;1200,00\r\n' +
        '22/10/2026 10:00;Estorno;;;50,00;1150,00\r\n' +
        ';Saldo final;;;;1150,00\r\n',
    );
  });

  it('formata data e hora em São Paulo', () => {
    expect(dataHoraEmSaoPaulo('2026-10-21T02:30:00Z')).toBe('20/10/2026 23:30');
  });
});
