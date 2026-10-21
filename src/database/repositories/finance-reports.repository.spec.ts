import { DataSource } from 'typeorm';
import {
  AgrupamentoDeRecebimentos,
  FinanceReportsRepository,
  SQL_DA_PRODUCAO,
  SQL_EM_ABERTO,
  SQL_MOVIMENTOS_DO_EXTRATO,
  SQL_SALDOS_DO_EXTRATO,
  expressaoDeDataLocal,
  sqlDosRecebimentos,
} from './finance-reports.repository';

const FUSO = "AT TIME ZONE 'America/Sao_Paulo'";

function montar() {
  const query = jest.fn().mockResolvedValue([]);
  const qb = {
    withDeleted: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const repository = {
    manager: { query },
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repository),
  } as unknown as DataSource;
  return { repo: new FinanceReportsRepository(dataSource), query, qb };
}

describe('FinanceReportsRepository — SQL', () => {
  it('converte a data para o fuso de São Paulo antes de formatar', () => {
    expect(expressaoDeDataLocal('p.paid_at', 'YYYY-MM-DD')).toBe(
      `to_char(p.paid_at ${FUSO}, 'YYYY-MM-DD')`,
    );
  });

  it.each([
    ['day', 'YYYY-MM-DD'],
    ['month', 'YYYY-MM'],
  ] as const)(
    'agrupamento por %s usa o dia/mês de São Paulo no pagamento e no estorno',
    (agrupamento, formato) => {
      const sql = sqlDosRecebimentos(agrupamento);
      expect(sql).toContain(`to_char(p.paid_at ${FUSO}, '${formato}')`);
      expect(sql).toContain(`to_char(r.created_at ${FUSO}, '${formato}')`);
    },
  );

  it.each(['day', 'month', 'method', 'account', 'user'] as const)(
    'recebimentos por %s filtram o período pelo início e fim do dia em São Paulo',
    (agrupamento) => {
      const sql = sqlDosRecebimentos(agrupamento);
      expect(sql).toContain(`p.paid_at >= (($2)::date::timestamp ${FUSO})`);
      expect(sql).toContain(
        `p.paid_at < ((($3)::date + 1)::timestamp ${FUSO})`,
      );
      expect(sql).toContain('r.created_at >=');
      expect(sql).toContain('WHERE p.owner_id = $1');
      expect(sql).toContain('WHERE r.owner_id = $1');
    },
  );

  it('estornos entram pela data do estorno e somam no mesmo grupo do pagamento', () => {
    const sql = sqlDosRecebimentos('method');
    expect(sql).toContain('JOIN payments p ON p.id = r.payment_id');
    expect(sql).toContain('r.amount AS estornado');
    expect(sql.match(/p\.method::text/g)).toHaveLength(2);
  });

  it('por conta usa a conta do pagamento ou a do caixa', () => {
    const sql = sqlDosRecebimentos('account');
    expect(sql).toContain('COALESCE(p.account_id, cs.account_id)');
    expect(sql).toContain('fa.name');
  });

  it('recusa agrupamento desconhecido', () => {
    expect(() =>
      sqlDosRecebimentos('semana' as AgrupamentoDeRecebimentos),
    ).toThrow('Agrupamento inválido');
  });

  it('produção ignora itens e cobranças cancelados e rateia o recebido em centavos', () => {
    expect(SQL_DA_PRODUCAO).toContain('i.cancelled_at IS NULL');
    expect(SQL_DA_PRODUCAO).toContain("r.status <> 'cancelled'");
    expect(SQL_DA_PRODUCAO).toContain(
      'ROUND(i.total / r.total_amount * r.paid_amount, 2)',
    );
    expect(SQL_DA_PRODUCAO).toContain('WHEN r.total_amount > 0');
    expect(SQL_DA_PRODUCAO).toContain(
      'COALESCE(i.executed_at, r.reference_date) <= $3::date',
    );
  });

  it('produção inclui itens sem executante e sem data de execução', () => {
    expect(SQL_DA_PRODUCAO).toContain('LEFT JOIN users u');
    expect(SQL_DA_PRODUCAO).toContain('GROUP BY i.executed_by_id');
    expect(SQL_DA_PRODUCAO).not.toMatch(/AND i\.executed_at [<>]=/);
    expect(SQL_DA_PRODUCAO).not.toContain('executed_by_id IS NOT NULL');
  });

  it('em aberto calcula a idade a partir de hoje em São Paulo', () => {
    expect(SQL_EM_ABERTO).toContain(`(now() ${FUSO})::date`);
    expect(SQL_EM_ABERTO).toContain("r.status IN ('open', 'partial')");
    expect(SQL_EM_ABERTO).toContain(
      'COALESCE(r.due_date, r.reference_date) <= $2::date',
    );
  });

  it('extrato usa saldo corrente ordenado e limites do dia em São Paulo', () => {
    expect(SQL_MOVIMENTOS_DO_EXTRATO).toContain('SUM(');
    expect(SQL_MOVIMENTOS_DO_EXTRATO).toContain(
      'ORDER BY e.occurred_at, e.created_at, e.id',
    );
    expect(SQL_MOVIMENTOS_DO_EXTRATO).toContain(FUSO);
    expect(SQL_SALDOS_DO_EXTRATO).toContain(FUSO);
    expect(SQL_SALDOS_DO_EXTRATO).toContain('e.account_id = $2');
  });
});

describe('FinanceReportsRepository — parâmetros', () => {
  const periodo = { from: '2026-10-01', to: '2026-10-31' };

  it('recebimentos passa tenant e período', async () => {
    const { repo, query } = montar();
    await repo.recebimentos('owner-1', periodo, 'day');
    expect(query).toHaveBeenCalledWith(sqlDosRecebimentos('day'), [
      'owner-1',
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('produção e em aberto passam o tenant', async () => {
    const { repo, query } = montar();
    await repo.producao('owner-1', periodo);
    await repo.emAberto('owner-1', '2026-10-20');
    expect(query).toHaveBeenNthCalledWith(1, SQL_DA_PRODUCAO, [
      'owner-1',
      '2026-10-01',
      '2026-10-31',
    ]);
    expect(query).toHaveBeenNthCalledWith(2, SQL_EM_ABERTO, [
      'owner-1',
      '2026-10-20',
    ]);
  });

  it('saldos do extrato caem para zero sem linha', async () => {
    const { repo, query } = montar();
    await expect(
      repo.saldosDoExtrato('owner-1', 'conta-1', periodo),
    ).resolves.toEqual({ saldoInicial: '0.00', saldoFinal: '0.00' });
    expect(query).toHaveBeenCalledWith(SQL_SALDOS_DO_EXTRATO, [
      'owner-1',
      'conta-1',
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('dados do recibo filtram pagamento e cobrança pelo tenant', async () => {
    const { repo, qb } = montar();
    await repo.dadosDoRecibo('owner-1', 'pay-1');
    expect(qb.where).toHaveBeenCalledWith('payment.id = :paymentId', {
      paymentId: 'pay-1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('payment.ownerId = :ownerId', {
      ownerId: 'owner-1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('receivable.ownerId = :ownerId', {
      ownerId: 'owner-1',
    });
    const campos = qb.select.mock.calls[0][0] as string[];
    expect(campos).toContain('patient.cpf');
    expect(campos).not.toContain('patient.medicalNotes');
  });
});
