import { Ledger } from '../core/ledger';
import { LEDGER_CONSULTA } from './mappers/appointment.mapper';
import { LEDGER_HISTORICO } from './mappers/activity.mapper';
import {
  LEDGER_FICHA,
  LEDGER_MODELO_ANAMNESE,
} from './mappers/clinical-record.mapper';
import { LEDGER_CLINICA } from './mappers/clinic.mapper';
import { LEDGER_DOCUMENTO, LEDGER_FOTO } from './mappers/document.mapper';
import { LEDGER_MODELO_DOCUMENTO } from './mappers/doc-template.mapper';
import { LEDGER_CONVENIO } from './mappers/health-plan.mapper';
import { LEDGER_PACIENTE } from './mappers/patient.mapper';
import { LEDGER_SALA } from './mappers/appointment.mapper';
import { LEDGER_FUNCIONARIO, LEDGER_PROFISSIONAL } from './mappers/team.mapper';
import {
  LEDGER_BLOQUEIO,
  LEDGER_FERIADO,
  LEDGER_GRADE,
} from './mappers/availability.mapper';

import {
  compararSomas,
  LEDGER_CAIXA,
  LEDGER_COBRANCA,
  LEDGER_CONTA_FINANCEIRA,
  LEDGER_ESTORNO,
  LEDGER_ITEM_DE_COBRANCA,
  LEDGER_LANCAMENTO,
  LEDGER_PAGAMENTO,
  ResumoFinanceiro,
} from './mappers/finance.mapper';

export type Consultar = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export const COLUNAS_EXIGIDAS: Record<string, string[]> = {
  patients: ['photo_path', 'secondary_phone'],
  doctor_profiles: ['council'],
  clinic_rooms: ['id'],
  appointments: ['room_id', 'is_walk_in', 'health_plan_id', 'created_by_id'],
  appointment_activities: ['id'],
  clinical_document_templates: ['id'],
  doctor_schedules: ['id'],
  schedule_blocks: ['id'],
  holidays: ['id'],
};

export const COLUNAS_EXIGIDAS_FINANCEIRO: Record<string, string[]> = {
  financial_accounts: ['id', 'type'],
  payment_method_configs: ['id', 'default_account_id', 'max_installments'],
  cash_sessions: ['id', 'counted_amount', 'expected_amount'],
  receivables: ['id', 'paid_amount', 'status'],
  receivable_items: ['id', 'executed_by_id', 'total'],
  payments: ['id', 'cash_session_id', 'refunded_amount'],
  refunds: ['id', 'reason'],
  financial_entries: ['id', 'counterpart_entry_id'],
  appointments: ['price'],
};

export function colunasExigidas(fase: string): Record<string, string[]> {
  if (fase !== 'financeiro') return COLUNAS_EXIGIDAS;
  const todas: Record<string, string[]> = { ...COLUNAS_EXIGIDAS };
  for (const [tabela, colunas] of Object.entries(COLUNAS_EXIGIDAS_FINANCEIRO)) {
    todas[tabela] = [...new Set([...(todas[tabela] ?? []), ...colunas])];
  }
  return todas;
}

export async function verificarSchema(
  consultar: Consultar,
  exigidas: Record<string, string[]> = COLUNAS_EXIGIDAS,
): Promise<string[]> {
  const linhas: { table_name: string; column_name: string }[] = await consultar(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [Object.keys(exigidas)],
  );
  const existentes = new Set(
    linhas.map((l) => `${l.table_name}.${l.column_name}`),
  );
  return Object.entries(exigidas).flatMap(([tabela, colunas]) =>
    colunas
      .map((c) => `${tabela}.${c}`)
      .filter((chave) => !existentes.has(chave)),
  );
}

const CONFERENCIA: {
  entidade: string;
  rotulo: string;
  sql: string;
}[] = [
  {
    entidade: LEDGER_CLINICA,
    rotulo: 'clínica',
    sql: 'SELECT count(*)::int AS n FROM clinics WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_PROFISSIONAL,
    rotulo: 'profissional',
    sql: 'SELECT count(*)::int AS n FROM users WHERE id = ANY($1) AND owner_id = $2 AND deleted_at IS NULL',
  },
  {
    entidade: LEDGER_FUNCIONARIO,
    rotulo: 'funcionário',
    sql: 'SELECT count(*)::int AS n FROM users WHERE id = ANY($1) AND owner_id = $2 AND deleted_at IS NULL',
  },
  {
    entidade: LEDGER_CONVENIO,
    rotulo: 'convênio',
    sql: 'SELECT count(*)::int AS n FROM health_plans WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_PACIENTE,
    rotulo: 'paciente',
    sql: 'SELECT count(*)::int AS n FROM patients WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_SALA,
    rotulo: 'sala',
    sql: 'SELECT count(*)::int AS n FROM clinic_rooms WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_CONSULTA,
    rotulo: 'consulta',
    sql: 'SELECT count(*)::int AS n FROM appointments WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_HISTORICO,
    rotulo: 'consulta com histórico',
    sql: 'SELECT count(DISTINCT a.appointment_id)::int AS n FROM appointment_activities a JOIN appointments ap ON ap.id = a.appointment_id WHERE a.appointment_id = ANY($1) AND ap.owner_id = $2',
  },
  {
    entidade: LEDGER_FICHA,
    rotulo: 'ficha',
    sql: 'SELECT count(*)::int AS n FROM clinical_records WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_MODELO_ANAMNESE,
    rotulo: 'modelo de anamnese',
    sql: 'SELECT count(*)::int AS n FROM clinical_record_templates WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_DOCUMENTO,
    rotulo: 'anexo',
    sql: 'SELECT count(*)::int AS n FROM documents d JOIN patients p ON p.id = d.patient_id WHERE d.id = ANY($1) AND p.owner_id = $2 AND d.uri IS NOT NULL',
  },
  {
    entidade: LEDGER_FOTO,
    rotulo: 'foto de paciente',
    sql: 'SELECT count(*)::int AS n FROM patients WHERE id = ANY($1) AND owner_id = $2 AND photo_path IS NOT NULL',
  },
  {
    entidade: LEDGER_MODELO_DOCUMENTO,
    rotulo: 'modelo de documento',
    sql: 'SELECT count(*)::int AS n FROM clinical_document_templates WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_GRADE,
    rotulo: 'período de grade',
    sql: 'SELECT count(*)::int AS n FROM doctor_schedules WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_BLOQUEIO,
    rotulo: 'bloqueio',
    sql: 'SELECT count(*)::int AS n FROM schedule_blocks WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_FERIADO,
    rotulo: 'feriado',
    sql: 'SELECT count(*)::int AS n FROM holidays WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_CONTA_FINANCEIRA,
    rotulo: 'conta financeira',
    sql: 'SELECT count(*)::int AS n FROM financial_accounts WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_CAIXA,
    rotulo: 'caixa',
    sql: 'SELECT count(*)::int AS n FROM cash_sessions WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_COBRANCA,
    rotulo: 'cobrança',
    sql: 'SELECT count(*)::int AS n FROM receivables WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_ITEM_DE_COBRANCA,
    rotulo: 'item de cobrança',
    sql: 'SELECT count(*)::int AS n FROM receivable_items WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_PAGAMENTO,
    rotulo: 'pagamento',
    sql: 'SELECT count(*)::int AS n FROM payments WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_ESTORNO,
    rotulo: 'estorno',
    sql: 'SELECT count(*)::int AS n FROM refunds WHERE id = ANY($1) AND owner_id = $2',
  },
  {
    entidade: LEDGER_LANCAMENTO,
    rotulo: 'lançamento financeiro',
    sql: 'SELECT count(*)::int AS n FROM financial_entries WHERE id = ANY($1) AND owner_id = $2',
  },
];

export interface LinhaConferencia {
  rotulo: string;
  previstos: number;
  encontrados: number;
}

export async function verificarCarga(
  consultar: Consultar,
  ledger: Ledger,
  ownerId: string,
): Promise<LinhaConferencia[]> {
  const mapa = ledger.paraObjeto();
  const linhas: LinhaConferencia[] = [];
  for (const c of CONFERENCIA) {
    const ids = [...new Set(Object.values(mapa[c.entidade] ?? {}))];
    if (!ids.length) continue;
    const [{ n }] = await consultar<{ n: number }>(c.sql, [ids, ownerId]);
    linhas.push({ rotulo: c.rotulo, previstos: ids.length, encontrados: n });
  }
  return linhas;
}

export function formatarConferencia(linhas: LinhaConferencia[]): string {
  const largura = Math.max(...linhas.map((l) => l.rotulo.length), 10);
  return linhas
    .map(
      (l) =>
        `  ${l.rotulo.padEnd(largura)}  ${String(l.encontrados).padStart(6)} / ${String(l.previstos).padEnd(6)}${l.encontrados === l.previstos ? '' : '  ← faltando'}`,
    )
    .join('\n');
}

export interface ConferenciaFinanceira {
  somas: ReturnType<typeof compararSomas>;
  dinheiroSemCaixa: number;
  ok: boolean;
}

const idsDoLedger = (ledger: Ledger, entidade: string) => [
  ...new Set(Object.values(ledger.paraObjeto()[entidade] ?? {})),
];

export async function verificarFinanceiro(
  consultar: Consultar,
  ledger: Ledger,
  ownerId: string,
  esperado: ResumoFinanceiro,
): Promise<ConferenciaFinanceira> {
  const pagamentos = idsDoLedger(ledger, LEDGER_PAGAMENTO);
  const estornos = idsDoLedger(ledger, LEDGER_ESTORNO);
  const cobrancas = idsDoLedger(ledger, LEDGER_COBRANCA);
  const obtido: ResumoFinanceiro = {
    somas: { porAno: {}, porForma: {} },
    abertas: 0,
    parciais: 0,
  };
  const somar = (alvo: Record<string, number>, chave: string, v: number) => {
    alvo[chave] = (alvo[chave] ?? 0) + v;
  };
  const linhasPagamento = await consultar<{
    ano: string;
    metodo: string;
    centavos: string;
  }>(
    `SELECT to_char(paid_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY') AS ano,
            method AS metodo, (sum(amount) * 100)::bigint::text AS centavos
       FROM payments WHERE id = ANY($1) AND owner_id = $2
      GROUP BY 1, 2`,
    [pagamentos, ownerId],
  );
  for (const l of linhasPagamento) {
    somar(obtido.somas.porAno, l.ano, Number(l.centavos));
    somar(obtido.somas.porForma, l.metodo, Number(l.centavos));
  }
  const linhasEstorno = await consultar<{
    ano: string;
    metodo: string;
    centavos: string;
  }>(
    `SELECT to_char(r.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY') AS ano,
            p.method AS metodo, (sum(r.amount) * 100)::bigint::text AS centavos
       FROM refunds r JOIN payments p ON p.id = r.payment_id
      WHERE r.id = ANY($1) AND r.owner_id = $2
      GROUP BY 1, 2`,
    [estornos, ownerId],
  );
  for (const l of linhasEstorno) {
    somar(obtido.somas.porAno, l.ano, -Number(l.centavos));
    somar(obtido.somas.porForma, l.metodo, -Number(l.centavos));
  }
  const status = await consultar<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM receivables
      WHERE id = ANY($1) AND owner_id = $2 GROUP BY status`,
    [cobrancas, ownerId],
  );
  for (const s of status) {
    if (s.status === 'open') obtido.abertas = s.n;
    if (s.status === 'partial') obtido.parciais = s.n;
  }
  const [{ n: dinheiroSemCaixa }] = await consultar<{ n: number }>(
    `SELECT count(*)::int AS n FROM payments p
       LEFT JOIN financial_accounts a ON a.id = p.account_id
      WHERE p.id = ANY($1) AND p.owner_id = $2 AND p.method = 'cash'
        AND p.cash_session_id IS NULL
        AND (a.type IS NULL OR a.type <> 'cash_drawer')`,
    [pagamentos, ownerId],
  );
  const somas = compararSomas(esperado, obtido, 'banco');
  const diferencas = [
    ...Object.values(somas.porAno),
    ...Object.values(somas.porForma),
  ].some((l) => l.diferenca !== '0.00');
  return {
    somas,
    dinheiroSemCaixa,
    ok:
      !diferencas &&
      esperado.abertas === obtido.abertas &&
      esperado.parciais === obtido.parciais &&
      dinheiroSemCaixa === 0,
  };
}

export function formatarConferenciaFinanceira(
  c: ConferenciaFinanceira,
): string {
  const linhas = ['== Conferência do financeiro (export × banco)'];
  for (const [titulo, tabela] of [
    ['por ano', c.somas.porAno],
    ['por forma', c.somas.porForma],
  ] as const) {
    linhas.push(`  ${titulo}:`);
    for (const [chave, l] of Object.entries(tabela)) {
      linhas.push(
        `    ${chave.padEnd(14)} export ${l.export.padStart(12)}  banco ${String(l.banco).padStart(12)}${l.diferenca === '0.00' ? '' : `  ← diferença ${l.diferenca}`}`,
      );
    }
  }
  linhas.push(
    `  cobranças abertas: ${c.somas.abertas.banco} / ${c.somas.abertas.export}`,
    `  cobranças parciais: ${c.somas.parciais.banco} / ${c.somas.parciais.export}`,
    `  pagamentos em dinheiro sem caixa: ${c.dinheiroSemCaixa}`,
  );
  return linhas.join('\n');
}
