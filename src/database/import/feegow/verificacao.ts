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

export type Consultar = (sql: string, params?: unknown[]) => Promise<any[]>;

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

export async function verificarSchema(consultar: Consultar): Promise<string[]> {
  const linhas: { table_name: string; column_name: string }[] = await consultar(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [Object.keys(COLUNAS_EXIGIDAS)],
  );
  const existentes = new Set(
    linhas.map((l) => `${l.table_name}.${l.column_name}`),
  );
  return Object.entries(COLUNAS_EXIGIDAS).flatMap(([tabela, colunas]) =>
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
    const [{ n }] = await consultar(c.sql, [ids, ownerId]);
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
