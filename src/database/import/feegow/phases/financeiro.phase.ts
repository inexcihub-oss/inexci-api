import { EntityManager } from 'typeorm';
import { CashSession } from 'src/database/entities/cash-session.entity';
import {
  FinancialAccount,
  FinancialAccountType,
} from 'src/database/entities/financial-account.entity';
import { FinancialEntry } from 'src/database/entities/financial-entry.entity';
import { Payment } from 'src/database/entities/payment.entity';
import {
  PaymentMethod,
  PaymentMethodConfig,
} from 'src/database/entities/payment-method-config.entity';
import { ReceivableItem } from 'src/database/entities/receivable-item.entity';
import { Receivable } from 'src/database/entities/receivable.entity';
import { Refund } from 'src/database/entities/refund.entity';
import { Ledger } from '../../core/ledger';
import { Relatorio } from '../../core/report';
import { chaveDeNome, ContextoImportacao } from '../context';
import { ExportFeegow, TABELAS_FINANCEIRAS } from '../export';
import { LEDGER_CONSULTA } from '../mappers/appointment.mapper';
import {
  DadosFinanceirosDoBanco,
  LEDGER_PRECO_DA_CONSULTA,
  LEDGERS_FINANCEIROS,
  PlanoFinanceiroDoExport,
  planejarFinanceiroDoExport,
} from '../mappers/finance.mapper';
import { LEDGER_PACIENTE } from '../mappers/patient.mapper';
import {
  LEDGER_FUNCIONARIO,
  LEDGER_PROFISSIONAL,
} from '../mappers/team.mapper';
import type { Consultar } from '../verificacao';
import { paraCentavos } from 'src/modules/finance/utils/dinheiro';
import { inserirEmLotes } from './inserir-em-lotes';

export const LEDGERS_EXIGIDOS_PELO_FINANCEIRO = [
  LEDGER_PACIENTE,
  LEDGER_CONSULTA,
  LEDGER_PROFISSIONAL,
  LEDGER_FUNCIONARIO,
];

export interface PlanoFinanceiro extends PlanoFinanceiroDoExport {
  ownerId: string;
  ledger: Ledger;
  relatorio: Relatorio;
}

export function assertPreCondicoesDoFinanceiro(
  exp: ExportFeegow,
  ledger: Ledger,
): void {
  const faltandoNoExport = TABELAS_FINANCEIRAS.filter((t) => !exp.temTabela(t));
  if (faltandoNoExport.length) {
    throw new Error(
      `Export sem as tabelas financeiras (${faltandoNoExport.join(', ')}). Confira a pasta do export.`,
    );
  }
  const faltandoNoLedger = LEDGERS_EXIGIDOS_PELO_FINANCEIRO.filter(
    (e) => ledger.total(e) === 0,
  );
  if (faltandoNoLedger.length) {
    throw new Error(
      `A fase financeiro precisa do ledger da carga de produção (faltam: ${faltandoNoLedger.join(', ')}). ` +
        'Use o mesmo --out da carga de cadastro, agenda e prontuário.',
    );
  }
  const jaGravados = LEDGERS_FINANCEIROS.filter((e) => ledger.total(e) > 0);
  if (jaGravados.length) {
    throw new Error(
      `A fase financeiro já foi gravada com este ledger (${jaGravados.join(', ')}). ` +
        'Rodar de novo duplicaria cobranças e pagamentos: abortado.',
    );
  }
}

export function planejarFinanceiro(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoFinanceiro {
  assertPreCondicoesDoFinanceiro(exp, ctx.ledger);
  if (!ctx.financeiro) {
    ctx.relatorio.avisar(
      'financeiro',
      '-',
      'sem banco: contas e formas já cadastradas na INEXCI e o CPF dos pacientes fora do ledger (D2) não foram conferidos',
    );
  }
  return {
    ...planejarFinanceiroDoExport(exp, ctx),
    ownerId: ctx.ownerId,
    ledger: ctx.ledger,
    relatorio: ctx.relatorio,
  };
}

export async function carregarFinanceiro(
  consultar: Consultar,
  ctx: ContextoImportacao,
): Promise<void> {
  const contas = await consultar<{
    id: string;
    name: string;
    type: FinancialAccountType;
    active: boolean;
  }>(
    'SELECT id, name, type, active FROM financial_accounts WHERE owner_id = $1',
    [ctx.ownerId],
  );
  const formas = await consultar<{
    id: string;
    method: PaymentMethod;
    default_account_id: string | null;
    max_installments: number;
  }>(
    'SELECT id, method, default_account_id, max_installments FROM payment_method_configs WHERE owner_id = $1',
    [ctx.ownerId],
  );
  const pacientes = await consultar<{ id: string; cpf: string }>(
    `SELECT id, regexp_replace(cpf, '\\D', '', 'g') AS cpf FROM patients
      WHERE owner_id = $1 AND deleted_at IS NULL AND cpf IS NOT NULL`,
    [ctx.ownerId],
  );
  const cobradas = await consultar<{ appointment_id: string }>(
    `SELECT appointment_id FROM receivables
      WHERE owner_id = $1 AND appointment_id IS NOT NULL AND status <> 'cancelled'`,
    [ctx.ownerId],
  );

  const pacientesPorCpf = new Map<string, string[]>();
  for (const p of pacientes) {
    if (!p.cpf) continue;
    pacientesPorCpf.set(p.cpf, [...(pacientesPorCpf.get(p.cpf) ?? []), p.id]);
  }
  const dados: DadosFinanceirosDoBanco = {
    contasPorNome: new Map(
      contas.map((c) => [
        chaveDeNome(c.name),
        { id: c.id, type: c.type, active: c.active },
      ]),
    ),
    formas: new Map(
      formas.map((f) => [
        f.method,
        {
          id: f.id,
          defaultAccountId: f.default_account_id,
          maxInstallments: Number(f.max_installments),
        },
      ]),
    ),
    pacientesPorCpf,
    consultasComCobranca: new Set(cobradas.map((c) => c.appointment_id)),
  };
  ctx.financeiro = dados;
}

export function linhasDoUpdate<T>(resultado: unknown): T[] {
  if (
    Array.isArray(resultado) &&
    resultado.length === 2 &&
    Array.isArray(resultado[0]) &&
    typeof resultado[1] === 'number'
  ) {
    return resultado[0] as T[];
  }
  return Array.isArray(resultado) ? (resultado as T[]) : [];
}

export function violacoesDasRestricoes(plano: PlanoFinanceiro): string[] {
  const erros: string[] = [];
  const c = (v: string) => paraCentavos(v);
  for (const r of plano.cobrancas) {
    if (c(r.paidAmount) < 0) erros.push(`cobrança ${r.id}: recebido negativo`);
  }
  for (const i of plano.itens) {
    if (i.quantity < 1) erros.push(`item ${i.id}: quantidade menor que 1`);
    if (c(i.discount) < 0) erros.push(`item ${i.id}: desconto negativo`);
    if (c(i.surcharge) < 0) erros.push(`item ${i.id}: acréscimo negativo`);
  }
  for (const p of plano.pagamentos) {
    if (c(p.amount) <= 0) erros.push(`pagamento ${p.id}: valor não positivo`);
    if (c(p.refundedAmount) < 0 || c(p.refundedAmount) > c(p.amount)) {
      erros.push(`pagamento ${p.id}: estornado fora de 0..valor`);
    }
  }
  for (const e of plano.estornos) {
    if (c(e.amount) <= 0) erros.push(`estorno ${e.id}: valor não positivo`);
  }
  return erros;
}

export async function gravarFinanceiro(
  plano: PlanoFinanceiro,
  manager: EntityManager,
): Promise<void> {
  const violacoes = violacoesDasRestricoes(plano);
  if (violacoes.length) {
    throw new Error(
      `Plano financeiro viola as restrições do banco (${violacoes.length}):\n${violacoes.slice(0, 20).join('\n')}`,
    );
  }
  await inserirEmLotes(manager, FinancialAccount, plano.contas);
  await inserirEmLotes(manager, PaymentMethodConfig, plano.formasNovas);
  for (const f of plano.formasAtualizadas) {
    await manager.query(
      `UPDATE payment_method_configs
          SET default_account_id = COALESCE(default_account_id, $2),
              max_installments = CASE WHEN max_installments = 1 THEN COALESCE($3, max_installments) ELSE max_installments END,
              updated_at = now()
        WHERE id = $1`,
      [f.id, f.defaultAccountId ?? null, f.maxInstallments ?? null],
    );
  }
  await inserirEmLotes(manager, CashSession, plano.caixas);
  await inserirEmLotes(manager, Receivable, plano.cobrancas);
  await inserirEmLotes(manager, ReceivableItem, plano.itens);
  await inserirEmLotes(manager, Payment, plano.pagamentos);
  await inserirEmLotes(manager, Refund, plano.estornos);
  await inserirEmLotes(manager, FinancialEntry, plano.lancamentos);
  if (plano.contrapartidas.length) {
    await manager.query(
      `UPDATE financial_entries f SET counterpart_entry_id = v.cp
         FROM unnest($1::uuid[], $2::uuid[]) AS v(id, cp)
        WHERE f.id = v.id`,
      [
        plano.contrapartidas.map(([id]) => id),
        plano.contrapartidas.map(([, cp]) => cp),
      ],
    );
  }
  await gravarPrecos(plano, manager);
}

async function gravarPrecos(
  plano: PlanoFinanceiro,
  manager: EntityManager,
): Promise<void> {
  if (!plano.precos.length) return;
  const resultado: unknown = await manager.query(
    `UPDATE appointments a SET price = v.price::numeric
       FROM unnest($1::uuid[], $2::text[]) AS v(id, price)
      WHERE a.id = v.id AND a.price IS NULL AND a.owner_id = $3
      RETURNING a.id`,
    [
      plano.precos.map((p) => p.appointmentId),
      plano.precos.map((p) => p.price),
      plano.ownerId,
    ],
  );
  const feitas = new Set(
    linhasDoUpdate<{ id: string }>(resultado).map((a) => a.id),
  );
  let preservadas = 0;
  for (const p of plano.precos) {
    if (feitas.has(p.appointmentId)) continue;
    plano.ledger.removerPorUuid(LEDGER_PRECO_DA_CONSULTA, p.appointmentId);
    plano.relatorio.desfazerAceite('valor previsto da consulta');
    preservadas++;
  }
  if (preservadas) {
    plano.relatorio.avisar(
      'valor previsto da consulta',
      '-',
      `${preservadas} consultas já tinham valor na INEXCI: preservado`,
    );
  }
}
