import { BadRequestException } from '@nestjs/common';
import { FinanceReportsRepository } from 'src/database/repositories/finance-reports.repository';
import {
  FinanceReportsService,
  diaEmSaoPaulo,
  rotuloDaForma,
  rotuloDoGrupo,
} from './finance-reports.service';

function montar() {
  const repo = {
    recebimentos: jest.fn().mockResolvedValue([]),
    producao: jest.fn().mockResolvedValue([]),
    emAberto: jest.fn().mockResolvedValue([]),
  };
  const service = new FinanceReportsService(
    repo as unknown as FinanceReportsRepository,
  );
  return { repo, service };
}

const periodo = { from: '2026-10-01', to: '2026-10-31' };

describe('diaEmSaoPaulo', () => {
  it('pagamento às 23h30 de São Paulo (02h30 UTC do dia seguinte) cai no dia local', () => {
    expect(diaEmSaoPaulo(new Date('2026-10-21T02:30:00Z'))).toBe('2026-10-20');
  });

  it('00h30 de São Paulo já é o dia seguinte', () => {
    expect(diaEmSaoPaulo(new Date('2026-10-21T03:30:00Z'))).toBe('2026-10-21');
  });

  it('virada de mês respeita o fuso', () => {
    expect(diaEmSaoPaulo(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10-31');
  });
});

describe('rótulos', () => {
  it.each([
    ['day', { chave: '2026-10-05', nome: null }, '05/10/2026'],
    ['month', { chave: '2026-10', nome: null }, '10/2026'],
    ['method', { chave: 'credit_card', nome: null }, 'Cartão de crédito'],
    ['method', { chave: 'pix', nome: null }, 'PIX'],
    ['account', { chave: 'a-1', nome: 'Caixa Físico' }, 'Caixa Físico'],
    ['account', { chave: null, nome: null }, 'Sem conta'],
    ['user', { chave: 'u-1', nome: 'Maria' }, 'Maria'],
    ['user', { chave: null, nome: null }, 'Não informado'],
  ] as const)('%s %p → %p', (agrupamento, linha, esperado) => {
    expect(rotuloDoGrupo(agrupamento, linha)).toBe(esperado);
  });

  it('forma desconhecida devolve o próprio código', () => {
    expect(rotuloDaForma('crypto')).toBe('crypto');
    expect(rotuloDaForma(null)).toBe('Não informada');
  });
});

describe('FinanceReportsService.receipts', () => {
  it('calcula líquido por grupo e totais descontando estornos', async () => {
    const { repo, service } = montar();
    repo.recebimentos.mockResolvedValue([
      {
        chave: 'cash',
        nome: null,
        recebido: '300.00',
        estornado: '50.00',
        quantidade: 3,
      },
      {
        chave: 'pix',
        nome: null,
        recebido: '0.10',
        estornado: '0',
        quantidade: 1,
      },
      {
        chave: 'credit_card',
        nome: null,
        recebido: '0',
        estornado: '0.20',
        quantidade: 0,
      },
    ]);

    const relatorio = await service.receipts('owner-1', periodo, 'method');

    expect(repo.recebimentos).toHaveBeenCalledWith(
      'owner-1',
      periodo,
      'method',
    );
    expect(relatorio.groupBy).toBe('method');
    expect(relatorio.rows).toEqual([
      {
        key: 'cash',
        label: 'Dinheiro',
        received: '300.00',
        refunded: '50.00',
        net: '250.00',
        count: 3,
      },
      {
        key: 'pix',
        label: 'PIX',
        received: '0.10',
        refunded: '0.00',
        net: '0.10',
        count: 1,
      },
      {
        key: 'credit_card',
        label: 'Cartão de crédito',
        received: '0.00',
        refunded: '0.20',
        net: '-0.20',
        count: 0,
      },
    ]);
    expect(relatorio.totals).toEqual({
      received: '300.10',
      refunded: '50.20',
      net: '249.90',
      count: 4,
    });
  });

  it('recusa período invertido', async () => {
    const { service, repo } = montar();
    await expect(
      service.receipts(
        'owner-1',
        { from: '2026-10-31', to: '2026-10-01' },
        'day',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.recebimentos).not.toHaveBeenCalled();
  });

  it('gera CSV com vírgula decimal, cabeçalho em português e linha de total', async () => {
    const { repo, service } = montar();
    repo.recebimentos.mockResolvedValue([
      {
        chave: '2026-10-20',
        nome: null,
        recebido: '1234.50',
        estornado: '34.50',
        quantidade: 2,
      },
    ]);
    const relatorio = await service.receipts('owner-1', periodo, 'day');

    expect(service.receiptsCsv(relatorio)).toBe(
      'Dia;Recebido;Estornado;Líquido;Quantidade\r\n' +
        '20/10/2026;1234,50;34,50;1200,00;2\r\n' +
        'Total;1234,50;34,50;1200,00;2\r\n',
    );
  });
});

describe('FinanceReportsService.production', () => {
  it('nomeia o executante ausente e soma os totais', async () => {
    const { repo, service } = montar();
    repo.producao.mockResolvedValue([
      {
        executedById: 'd-1',
        nome: 'Dr. Fabio',
        itens: 3,
        faturado: '900.00',
        recebido: '600.33',
      },
      {
        executedById: null,
        nome: null,
        itens: '1',
        faturado: '100.00',
        recebido: '0',
      },
    ]);

    const relatorio = await service.production('owner-1', periodo);

    expect(relatorio.rows[1]).toEqual({
      executedById: null,
      name: 'Sem profissional',
      items: 1,
      billed: '100.00',
      received: '0.00',
    });
    expect(relatorio.totals).toEqual({
      items: 4,
      billed: '1000.00',
      received: '600.33',
    });
    expect(service.productionCsv(relatorio)).toBe(
      'Profissional;Itens;Faturado;Recebido\r\n' +
        'Dr. Fabio;3;900,00;600,33\r\n' +
        'Sem profissional;1;100,00;0,00\r\n' +
        'Total;4;1000,00;600,33\r\n',
    );
  });
});

describe('FinanceReportsService.open', () => {
  const linha = {
    receivableId: 'r-1',
    patientId: 'p-1',
    patientName: 'Ana; Souza',
    referenceDate: '2026-10-01',
    dueDate: '2026-10-10',
    totalAmount: '300.00',
    paidAmount: '100.00',
    balance: '200.00',
    ageDays: 10,
  };

  it('usa hoje em São Paulo quando until não vem', async () => {
    const { repo, service } = montar();
    await service.open('owner-1', {}, new Date('2026-10-21T02:30:00Z'));
    expect(repo.emAberto).toHaveBeenCalledWith('owner-1', '2026-10-20');
  });

  it('respeita o until informado e soma o saldo', async () => {
    const { repo, service } = montar();
    repo.emAberto.mockResolvedValue([
      linha,
      { ...linha, receivableId: 'r-2', dueDate: null, balance: '0.05' },
    ]);
    const relatorio = await service.open('owner-1', { until: '2026-10-15' });

    expect(repo.emAberto).toHaveBeenCalledWith('owner-1', '2026-10-15');
    expect(relatorio.rows[0]).toEqual({
      receivableId: 'r-1',
      patient: { id: 'p-1', name: 'Ana; Souza' },
      referenceDate: '2026-10-01',
      dueDate: '2026-10-10',
      totalAmount: '300.00',
      paidAmount: '100.00',
      balance: '200.00',
      ageDays: 10,
    });
    expect(relatorio.totals).toEqual({ count: 2, balance: '200.05' });

    const csv = service.openCsv(relatorio);
    expect(csv.split('\r\n')[0]).toBe(
      'Paciente;Data de referência;Vencimento;Total;Pago;Saldo;Dias em aberto',
    );
    expect(csv).toContain(
      '"Ana; Souza";01/10/2026;10/10/2026;300,00;100,00;200,00;10',
    );
    expect(csv).toContain('"Ana; Souza";01/10/2026;;300,00;100,00;0,05;10');
    expect(csv).toContain('Total (2);;;;;200,05;');
  });
});
