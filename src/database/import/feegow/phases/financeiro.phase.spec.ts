import { EntityManager } from 'typeorm';
import { CashSession } from 'src/database/entities/cash-session.entity';
import { FinancialAccount } from 'src/database/entities/financial-account.entity';
import { FinancialEntry } from 'src/database/entities/financial-entry.entity';
import { Payment } from 'src/database/entities/payment.entity';
import { PaymentMethodConfig } from 'src/database/entities/payment-method-config.entity';
import { ReceivableItem } from 'src/database/entities/receivable-item.entity';
import { Receivable } from 'src/database/entities/receivable.entity';
import { Refund } from 'src/database/entities/refund.entity';
import { Ledger } from '../../core/ledger';
import { ExportFeegow } from '../export';
import {
  LEDGER_COBRANCA,
  LEDGER_PRECO_DA_CONSULTA,
} from '../mappers/finance.mapper';
import { contextoDeTeste, OWNER } from '../testing/export-sintetico';
import {
  exportFinanceiro,
  ledgerDaCarga,
} from '../testing/financeiro-sintetico';
import { totalDoItem } from 'src/modules/finance/utils/dinheiro';
import {
  carregarFinanceiro,
  gravarFinanceiro,
  linhasDoUpdate,
  planejarFinanceiro,
  violacoesDasRestricoes,
} from './financeiro.phase';

function managerQueRegistra(atualizadas: string[] = []) {
  const inserts: { entidade: unknown; linhas: Record<string, unknown>[] }[] =
    [];
  const queries: { sql: string; params: unknown[] }[] = [];
  const manager = {
    createQueryBuilder: () => {
      const registro = {
        entidade: null as unknown,
        linhas: [] as Record<string, unknown>[],
      };
      const qb = {
        insert: () => qb,
        into: (e: unknown) => ((registro.entidade = e), qb),
        values: (v: Record<string, unknown>[]) => ((registro.linhas = v), qb),
        orIgnore: () => qb,
        execute: async () => {
          inserts.push(registro);
        },
      };
      return qb;
    },
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (/^\s*UPDATE/.test(sql)) {
        const linhas = sql.includes('UPDATE appointments')
          ? atualizadas.map((id) => ({ id }))
          : [];
        return [linhas, linhas.length];
      }
      return [];
    },
  } as unknown as EntityManager;
  return { manager, inserts, queries };
}

describe('planejarFinanceiro — pré-condições', () => {
  it('aborta sem o ledger da carga de produção', () => {
    const ctx = contextoDeTeste({ ledger: new Ledger(null) });
    expect(() => planejarFinanceiro(exportFinanceiro(), ctx)).toThrow(
      /precisa do ledger da carga de produção \(faltam: patient, appointment, user:prof, user:func\)/,
    );
  });

  it('aborta quando o export não tem as tabelas financeiras', () => {
    const ctx = contextoDeTeste({ ledger: ledgerDaCarga() });
    expect(() => planejarFinanceiro(new ExportFeegow(null, {}), ctx)).toThrow(
      /Export sem as tabelas financeiras/,
    );
  });

  it('segunda execução com o mesmo ledger aborta (idempotência)', () => {
    const ledger = ledgerDaCarga();
    planejarFinanceiro(exportFinanceiro(), contextoDeTeste({ ledger }));
    expect(ledger.total(LEDGER_COBRANCA)).toBeGreaterThan(0);
    expect(() =>
      planejarFinanceiro(exportFinanceiro(), contextoDeTeste({ ledger })),
    ).toThrow(/já foi gravada com este ledger/);
  });

  it('sem banco avisa que D2 e as contas da tela não foram conferidos', () => {
    const ctx = contextoDeTeste({ ledger: ledgerDaCarga() });
    planejarFinanceiro(exportFinanceiro(), ctx);
    expect(ctx.relatorio.avisos[0].aviso).toMatch(/^sem banco/);
  });
});

describe('carregarFinanceiro', () => {
  it('lê contas, formas, CPFs e consultas cobradas só da conta do dono', async () => {
    const consultar = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('financial_accounts'))
        return [
          { id: 'a1', name: 'Caixa Físico', type: 'cash_drawer', active: true },
        ];
      if (sql.includes('payment_method_configs'))
        return [
          {
            id: 'f1',
            method: 'pix',
            default_account_id: null,
            max_installments: 1,
          },
        ];
      if (sql.includes('FROM patients'))
        return [
          { id: 'p1', cpf: '52998224725' },
          { id: 'p2', cpf: '52998224725' },
        ];
      return [{ appointment_id: 'cons-9' }];
    });
    const ctx = contextoDeTeste();
    await carregarFinanceiro(consultar, ctx);
    for (const [, params] of consultar.mock.calls) {
      expect(params).toEqual([OWNER]);
    }
    expect(ctx.financeiro?.contasPorNome.get('caixa fisico')?.id).toBe('a1');
    expect(ctx.financeiro?.formas.get('pix' as never)?.id).toBe('f1');
    expect(ctx.financeiro?.pacientesPorCpf.get('52998224725')).toEqual([
      'p1',
      'p2',
    ]);
    expect(ctx.financeiro?.consultasComCobranca.has('cons-9')).toBe(true);
  });
});

describe('gravarFinanceiro', () => {
  it('insere na ordem das chaves estrangeiras e liga as contrapartidas depois', async () => {
    const plano = planejarFinanceiro(
      exportFinanceiro(),
      contextoDeTeste({ ledger: ledgerDaCarga() }),
    );
    const { manager, inserts, queries } = managerQueRegistra([
      'cons-1',
      'cons-3',
    ]);
    await gravarFinanceiro(plano, manager);
    expect(inserts.map((i) => i.entidade)).toEqual([
      FinancialAccount,
      PaymentMethodConfig,
      CashSession,
      Receivable,
      ReceivableItem,
      Payment,
      Refund,
      FinancialEntry,
    ]);
    const itens = inserts.find((i) => i.entidade === ReceivableItem)!.linhas;
    expect(itens.length).toBeGreaterThan(0);
    itens.forEach((i) => {
      const esperado = totalDoItem({
        unitAmount: i.unitAmount as string,
        quantity: i.quantity as number,
        discount: i.discount as string,
        surcharge: i.surcharge as string,
      });
      expect(i.total).toBe(esperado);
    });
    const contrapartidas = queries.find((q) =>
      q.sql.includes('counterpart_entry_id'),
    )!;
    expect((contrapartidas.params[0] as string[]).length).toBe(
      plano.contrapartidas.length,
    );
  });

  it('valor previsto: UPDATE só onde price é nulo, na conta do dono; consulta já com valor sai do ledger', async () => {
    const ctx = contextoDeTeste({ ledger: ledgerDaCarga() });
    const plano = planejarFinanceiro(exportFinanceiro(), ctx);
    const { manager, queries } = managerQueRegistra(['cons-1']);
    await gravarFinanceiro(plano, manager);
    const update = queries.find((q) => q.sql.includes('UPDATE appointments'))!;
    expect(update.sql).toContain('a.price IS NULL');
    expect(update.sql).toContain('a.owner_id = $3');
    expect(update.params).toEqual([
      ['cons-1', 'cons-3'],
      ['300.00', '250.00'],
      OWNER,
    ]);
    expect(ctx.ledger.resolver(LEDGER_PRECO_DA_CONSULTA, 'ag-1')).toBe(
      'cons-1',
    );
    expect(ctx.ledger.resolver(LEDGER_PRECO_DA_CONSULTA, 'ag-3')).toBeNull();
    expect(ctx.relatorio.avisos.map((a) => a.aviso)).toContain(
      '1 consultas já tinham valor na Inexci: preservado',
    );
  });

  it('valor gravado continua no ledger e só as preservadas são contadas (formato [linhas, rowCount] do driver)', async () => {
    const ctx = contextoDeTeste({ ledger: ledgerDaCarga() });
    const plano = planejarFinanceiro(exportFinanceiro(), ctx);
    const { manager } = managerQueRegistra(['cons-1', 'cons-3']);
    await gravarFinanceiro(plano, manager);
    expect(ctx.ledger.resolver(LEDGER_PRECO_DA_CONSULTA, 'ag-1')).toBe(
      'cons-1',
    );
    expect(ctx.ledger.resolver(LEDGER_PRECO_DA_CONSULTA, 'ag-3')).toBe(
      'cons-3',
    );
    expect(
      ctx.relatorio.avisos.some((a) => a.aviso.includes('já tinham valor')),
    ).toBe(false);
  });

  it('linhasDoUpdate lê o [linhas, rowCount] do UPDATE e o array simples', () => {
    expect(linhasDoUpdate([[{ id: 'a' }, { id: 'b' }], 2])).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(linhasDoUpdate([[], 0])).toEqual([]);
    expect(linhasDoUpdate([{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(linhasDoUpdate(undefined)).toEqual([]);
  });

  it('plano sintético respeita os CHECKs do banco; violação aborta antes de gravar', async () => {
    const ctx = contextoDeTeste({ ledger: ledgerDaCarga() });
    const plano = planejarFinanceiro(exportFinanceiro(), ctx);
    expect(violacoesDasRestricoes(plano)).toEqual([]);
    plano.pagamentos[0].refundedAmount = '999999.00';
    plano.itens[0].discount = '-1.00';
    expect(violacoesDasRestricoes(plano)).toHaveLength(2);
    const { manager, inserts } = managerQueRegistra();
    await expect(gravarFinanceiro(plano, manager)).rejects.toThrow(
      /viola as restrições do banco \(2\)/,
    );
    expect(inserts).toHaveLength(0);
  });

  it('atualiza a forma já configurada sem sobrescrever o que a tela definiu', async () => {
    const ctx = contextoDeTeste({
      ledger: ledgerDaCarga(),
      financeiro: {
        contasPorNome: new Map(),
        formas: new Map([
          [
            'credit_card' as never,
            { id: 'cfg-cc', defaultAccountId: null, maxInstallments: 1 },
          ],
        ]),
        pacientesPorCpf: new Map(),
        consultasComCobranca: new Set(),
      },
    });
    const plano = planejarFinanceiro(exportFinanceiro(), ctx);
    const { manager, queries } = managerQueRegistra();
    await gravarFinanceiro(plano, manager);
    const update = queries.find((q) =>
      q.sql.includes('UPDATE payment_method_configs'),
    )!;
    expect(update.sql).toContain('COALESCE(default_account_id, $2)');
    expect(update.params[0]).toBe('cfg-cc');
    expect(update.params[2]).toBe(12);
  });
});
