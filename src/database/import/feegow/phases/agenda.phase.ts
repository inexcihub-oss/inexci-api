import { EntityManager } from 'typeorm';
import { Appointment } from 'src/database/entities/appointment.entity';
import { ClinicRoom } from 'src/database/entities/clinic-room.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  NovaConsulta,
  NovaSala,
  planejarConsultas,
  planejarSalas,
} from '../mappers/appointment.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoAgenda {
  salas: NovaSala[];
  consultas: NovaConsulta[];
}

/**
 * Fase `agenda`: salas (dos `locais`) e consultas (dos `agendamentos`).
 * Depende da fase `cadastro` no ledger: clínica, equipe, convênios, pacientes.
 * Colisões de horário e bloqueios futuros vão para o relatório.
 */
export function planejarAgenda(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoAgenda {
  const salas = planejarSalas(exp, ctx);
  const { consultas, colisoes } = planejarConsultas(exp, ctx);
  ctx.relatorio.extras.colisoes = colisoes;
  ctx.relatorio.extras.bloqueiosFuturos = bloqueiosFuturos(exp, ctx.hoje);
  if (colisoes.length) {
    ctx.relatorio.avisar(
      'consulta',
      '-',
      `${colisoes.length} sobreposições de horário do mesmo profissional (lista em "colisoes")`,
    );
  }
  return { salas, consultas };
}

export async function gravarAgenda(
  plano: PlanoAgenda,
  manager: EntityManager,
): Promise<void> {
  await inserirEmLotes(manager, ClinicRoom, plano.salas);
  await inserirEmLotes(manager, Appointment, plano.consultas);
}

/**
 * Bloqueios de agenda de hoje em diante, para a secretária recriar à mão até
 * a INEXCI ter bloqueios (MIG-05). Sem nome de paciente — só profissional,
 * período e motivo.
 */
function bloqueiosFuturos(exp: ExportFeegow, hoje: string) {
  return exp
    .tabela('agenda_bloqueios')
    .filter((b) => (b.DataA ?? '') >= hoje && (b.FeriadoID ?? '0') === '0')
    .map((b) => ({
      profissional:
        b.ProfissionalID === '0' ? 'toda a clínica' : b.ProfissionalID,
      de: `${b.DataDe ?? ''} ${b.HoraDe ?? ''}`.trim(),
      ate: `${b.DataA ?? ''} ${b.HoraA ?? ''}`.trim(),
      motivo: [b.Titulo, b.Descricao].filter(Boolean).join(' — ') || null,
    }));
}
