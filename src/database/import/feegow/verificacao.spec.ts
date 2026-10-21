import { Ledger } from '../core/ledger';
import {
  colunasExigidas,
  COLUNAS_EXIGIDAS,
  formatarConferencia,
  formatarConferenciaFinanceira,
  verificarCarga,
  verificarFinanceiro,
  verificarSchema,
} from './verificacao';
import { ResumoFinanceiro } from './mappers/finance.mapper';

describe('verificarSchema', () => {
  it('devolve as colunas que faltam', async () => {
    const todas = Object.entries(COLUNAS_EXIGIDAS).flatMap(([t, cs]) =>
      cs.map((c) => ({ table_name: t, column_name: c })),
    );
    const consultar = jest
      .fn()
      .mockResolvedValue(
        todas.filter(
          (l) => !(l.table_name === 'holidays' || l.column_name === 'council'),
        ),
      );
    await expect(verificarSchema(consultar)).resolves.toEqual([
      'doctor_profiles.council',
      'holidays.id',
    ]);
    expect(consultar.mock.calls[0][1]).toEqual([Object.keys(COLUNAS_EXIGIDAS)]);
  });

  it('schema completo → nada falta', async () => {
    const todas = Object.entries(COLUNAS_EXIGIDAS).flatMap(([t, cs]) =>
      cs.map((c) => ({ table_name: t, column_name: c })),
    );
    await expect(
      verificarSchema(jest.fn().mockResolvedValue(todas)),
    ).resolves.toEqual([]);
  });
});

describe('verificarCarga', () => {
  it('confere só as entidades do ledger, por uuid distinto, na conta do dono', async () => {
    const ledger = new Ledger(null);
    ledger.registrar('patient', '10', 'p1');
    ledger.registrar('patient', '11', 'p2');
    ledger.registrar('health_plan', '14', 'hp1');
    ledger.registrar('health_plan', '15', 'hp1');
    const consultar = jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('FROM patients') ? [{ n: 1 }] : [{ n: 1 }],
      );

    const linhas = await verificarCarga(consultar, ledger, 'owner-1');

    expect(linhas).toEqual([
      { rotulo: 'convênio', previstos: 1, encontrados: 1 },
      { rotulo: 'paciente', previstos: 2, encontrados: 1 },
    ]);
    expect(consultar).toHaveBeenCalledTimes(2);
    for (const [sql, params] of consultar.mock.calls) {
      expect(sql).toContain('$2');
      expect(params[1]).toBe('owner-1');
    }
  });

  it('usuário excluído (deleted_at) não conta como encontrado', async () => {
    const ledger = new Ledger(null);
    ledger.registrar('user:prof', '8', 'u1');
    ledger.registrar('user:func', '2', 'u2');
    const consultar = jest.fn().mockResolvedValue([{ n: 1 }]);

    await verificarCarga(consultar, ledger, 'owner-1');

    const sqls = consultar.mock.calls.map(([sql]) => sql as string);
    const deUsuarios = sqls.filter((s) => s.includes('FROM users'));
    expect(deUsuarios).toHaveLength(2);
    for (const sql of deUsuarios) expect(sql).toContain('deleted_at IS NULL');
  });

  it('formatar marca o que não bateu', () => {
    const texto = formatarConferencia([
      { rotulo: 'paciente', previstos: 2, encontrados: 1 },
      { rotulo: 'convênio', previstos: 1, encontrados: 1 },
    ]);
    expect(texto.split('\n')[0]).toContain('← faltando');
    expect(texto.split('\n')[1]).not.toContain('faltando');
  });
});

describe('verificação do financeiro', () => {
  it('schema: só a fase financeiro exige as tabelas novas', () => {
    expect(colunasExigidas('agenda')).toBe(COLUNAS_EXIGIDAS);
    const fin = colunasExigidas('financeiro');
    expect(Object.keys(fin)).toEqual(
      expect.arrayContaining(['receivables', 'payments', 'cash_sessions']),
    );
    expect(fin.appointments).toEqual(
      expect.arrayContaining(['room_id', 'price']),
    );
  });

  const esperado: ResumoFinanceiro = {
    somas: {
      porAno: { '2025': 58000, '2026': 20000 },
      porForma: {
        cash: 18000,
        pix: 20000,
        debit_card: 0,
        other: 20000,
        credit_card: 20000,
      },
    },
    abertas: 1,
    parciais: 1,
  };

  function consultarCom(pix2025: string, dinheiroSemCaixa = 0) {
    return jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM payments WHERE'))
        return [
          { ano: '2025', metodo: 'cash', centavos: '18000' },
          { ano: '2025', metodo: 'pix', centavos: pix2025 },
          { ano: '2025', metodo: 'debit_card', centavos: '40000' },
          { ano: '2025', metodo: 'credit_card', centavos: '20000' },
          { ano: '2026', metodo: 'other', centavos: '20000' },
        ];
      if (sql.includes('FROM refunds'))
        return [{ ano: '2025', metodo: 'debit_card', centavos: '40000' }];
      if (sql.includes('GROUP BY status'))
        return [
          { status: 'open', n: 1 },
          { status: 'partial', n: 1 },
          { status: 'paid', n: 5 },
        ];
      return [{ n: dinheiroSemCaixa }];
    });
  }

  it('Σ pagamentos − Σ estornos por ano e por forma batem com o export', async () => {
    const ledger = new Ledger(null);
    ledger.registrar('payment', 'p1', 'u1');
    const consultar = consultarCom('20000');
    const r = await verificarFinanceiro(consultar, ledger, 'owner-1', esperado);
    expect(r.ok).toBe(true);
    expect(r.somas.porAno['2025']).toEqual({
      export: '580.00',
      banco: '580.00',
      diferenca: '0.00',
    });
    for (const [, params] of consultar.mock.calls) {
      expect(params[1]).toBe('owner-1');
    }
    expect(formatarConferenciaFinanceira(r)).not.toContain('diferença');
  });

  it('diferença de soma ou dinheiro sem caixa reprovam', async () => {
    const ledger = new Ledger(null);
    const diferente = await verificarFinanceiro(
      consultarCom('15000'),
      ledger,
      'owner-1',
      esperado,
    );
    expect(diferente.ok).toBe(false);
    expect(diferente.somas.porForma.pix.diferenca).toBe('50.00');
    expect(formatarConferenciaFinanceira(diferente)).toContain(
      '← diferença 50.00',
    );
    const semCaixa = await verificarFinanceiro(
      consultarCom('20000', 2),
      ledger,
      'owner-1',
      esperado,
    );
    expect(semCaixa.ok).toBe(false);
    expect(semCaixa.dinheiroSemCaixa).toBe(2);
  });

  it('a conferência por registro inclui as entidades financeiras do ledger', async () => {
    const ledger = new Ledger(null);
    ledger.registrar('receivable', '100', 'r1');
    ledger.registrar('payment', 'p1', 'pg1');
    const consultar = jest.fn().mockResolvedValue([{ n: 1 }]);
    const linhas = await verificarCarga(consultar, ledger, 'owner-1');
    expect(linhas.map((l) => l.rotulo)).toEqual(['cobrança', 'pagamento']);
  });
});
