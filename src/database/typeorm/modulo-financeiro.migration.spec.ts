import * as fs from 'fs';
import * as path from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import '../entities/financial-account.entity';
import '../entities/payment-method-config.entity';
import '../entities/cash-session.entity';
import '../entities/receivable.entity';
import '../entities/receivable-item.entity';
import '../entities/payment.entity';
import '../entities/refund.entity';
import '../entities/financial-entry.entity';
import { CreateFinancialAccountsAndPaymentMethodConfigs1760900000000 } from './migrations/1760900000000-CreateFinancialAccountsAndPaymentMethodConfigs';
import { CreateCashSessions1760900100000 } from './migrations/1760900100000-CreateCashSessions';
import { CreateReceivablesAndPayments1760900200000 } from './migrations/1760900200000-CreateReceivablesAndPayments';
import { AddPriceToAppointmentsAndCreateServicePrices1760900300000 } from './migrations/1760900300000-AddPriceToAppointmentsAndCreateServicePrices';

function fonte(arquivo: string): string {
  return fs.readFileSync(path.join(__dirname, 'migrations', arquivo), 'utf-8');
}

function executar(
  migration: { up(q: unknown): Promise<void>; down(q: unknown): Promise<void> },
  metodo: 'up' | 'down',
  respostaDaVerificacao: Record<string, unknown>[] = [],
) {
  const sqls: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      sqls.push(sql);
      return Promise.resolve(
        sql.includes('to_regclass') ? respostaDaVerificacao : [],
      );
    }),
  };
  return { sqls, promessa: migration[metodo](queryRunner) };
}

describe('migrations do módulo financeiro', () => {
  it('ordem: contas → caixa → cobrança → preço, para as FKs existirem', () => {
    const arquivos = fs
      .readdirSync(path.join(__dirname, 'migrations'))
      .filter((a) => a.startsWith('17609'))
      .sort();
    expect(arquivos).toEqual([
      '1760900000000-CreateFinancialAccountsAndPaymentMethodConfigs.ts',
      '1760900100000-CreateCashSessions.ts',
      '1760900200000-CreateReceivablesAndPayments.ts',
      '1760900300000-AddPriceToAppointmentsAndCreateServicePrices.ts',
    ]);
  });

  it('F1 cria o índice único (owner_id, method) e o limite de parcelas', async () => {
    const { sqls, promessa } = executar(
      new CreateFinancialAccountsAndPaymentMethodConfigs1760900000000(),
      'up',
    );
    await promessa;
    const tudo = sqls.join('\n');
    expect(tudo).toContain(
      'CREATE UNIQUE INDEX "uq_payment_method_configs_owner_method" ON "payment_method_configs" ("owner_id", "method")',
    );
    expect(tudo).toContain('"max_installments" BETWEEN 1 AND 24');
  });

  it('F1 aborta quando a tabela já existe, antes de qualquer DDL', async () => {
    const { sqls, promessa } = executar(
      new CreateFinancialAccountsAndPaymentMethodConfigs1760900000000(),
      'up',
      [{ tabela: 'financial_accounts', ids: 'financial_accounts' }],
    );
    await expect(promessa).rejects.toThrow('bloqueada');
    expect(sqls).toHaveLength(1);
  });

  it('caixa tem um único aberto por usuário', async () => {
    const { sqls, promessa } = executar(
      new CreateCashSessions1760900100000(),
      'up',
    );
    await promessa;
    expect(sqls.join('\n')).toContain(
      'CREATE UNIQUE INDEX "uq_cash_sessions_user_open" ON "cash_sessions" ("user_id") WHERE "closed_at" IS NULL',
    );
  });

  it('cobrança: total gravado pela aplicação, CHECKs e cobrança ativa única por consulta', async () => {
    const { sqls, promessa } = executar(
      new CreateReceivablesAndPayments1760900200000(),
      'up',
    );
    await promessa;
    const tudo = sqls.join('\n');
    expect(tudo).not.toContain('GENERATED');
    expect(tudo).toContain('"total" numeric(12,2) NOT NULL,');
    expect(tudo).toContain('CHECK ("paid_amount" >= 0)');
    expect(tudo).toContain('CHECK ("quantity" >= 1)');
    expect(tudo).toContain('CHECK ("discount" >= 0)');
    expect(tudo).toContain('CHECK ("surcharge" >= 0)');
    expect(tudo).toContain(
      'CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount")',
    );
    expect(tudo).toContain('CONSTRAINT "CHK_payments_amount_positive"');
    expect(tudo).toContain('CONSTRAINT "CHK_refunds_amount_positive"');
    expect(tudo).toContain(
      'CREATE UNIQUE INDEX "uq_payments_owner_idempotency_key" ON "payments" ("owner_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL',
    );
    expect(tudo).toContain('CREATE TABLE "payment_receipt_issues"');
    expect(tudo).toContain(
      'CHECK (("account_id" IS NOT NULL) <> ("cash_session_id" IS NOT NULL))',
    );
    expect(tudo).toContain('CHECK ("amount" > 0)');
    expect(tudo).toContain(
      `WHERE "status" <> 'cancelled' AND "appointment_id" IS NOT NULL`,
    );
  });

  it('down da cobrança derruba na ordem inversa das FKs', async () => {
    const { sqls, promessa } = executar(
      new CreateReceivablesAndPayments1760900200000(),
      'down',
    );
    await promessa;
    expect(sqls.map((s) => /"([^"]+)"/.exec(s)?.[1])).toEqual([
      'payment_receipt_issues',
      'financial_entries',
      'refunds',
      'payments',
      'receivable_items',
      'receivables',
    ]);
  });

  it('F4 acrescenta price opcional e reverte', async () => {
    const up = executar(
      new AddPriceToAppointmentsAndCreateServicePrices1760900300000(),
      'up',
    );
    await up.promessa;
    expect(up.sqls[0]).toContain(
      'ADD COLUMN IF NOT EXISTS "price" numeric(12,2)',
    );
    const down = executar(
      new AddPriceToAppointmentsAndCreateServicePrices1760900300000(),
      'down',
    );
    await down.promessa;
    expect(down.sqls.join('\n')).toContain('DROP COLUMN IF EXISTS "price"');
  });

  it('valores monetários são numeric(12,2), nunca float', () => {
    const arquivos = [
      '1760900100000-CreateCashSessions.ts',
      '1760900200000-CreateReceivablesAndPayments.ts',
      '1760900300000-AddPriceToAppointmentsAndCreateServicePrices.ts',
    ];
    arquivos.forEach((arquivo) => {
      const conteudo = fonte(arquivo);
      expect(conteudo).toContain('numeric(12,2)');
      expect(conteudo).not.toMatch(/\b(real|double precision|float)\b/i);
    });
  });

  it('todo CHECK criado pelas migrations está declarado com @Check na entidade', () => {
    const criados = fs
      .readdirSync(path.join(__dirname, 'migrations'))
      .filter((a) => a.startsWith('17609'))
      .flatMap((a) => [...fonte(a).matchAll(/CONSTRAINT "(CHK_[a-z_]+)"/g)])
      .map(([, nome]) => nome);
    const declarados = new Set(
      getMetadataArgsStorage().checks.map((c) => c.name),
    );

    expect(criados.length).toBeGreaterThan(0);
    expect(criados.filter((nome) => !declarados.has(nome))).toEqual([]);
  });
});
