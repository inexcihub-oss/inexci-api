import { EntityManager, In } from 'typeorm';
import {
  Appointment,
  OCCUPYING_APPOINTMENT_STATUSES,
} from 'src/database/entities/appointment.entity';
import { Ledger } from '../../core/ledger';
import { Relatorio } from '../../core/report';
import { ClinicRoom } from 'src/database/entities/clinic-room.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  chaveDeSala,
  encaixarSobrepostas,
  LEDGER_SALA,
  NovaConsulta,
  NovaSala,
  planejarConsultas,
  planejarSalas,
} from '../mappers/appointment.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoAgenda {
  salas: NovaSala[];
  consultas: NovaConsulta[];
  /** Origem no Feegow de cada consulta planejada (para o relatório). */
  origem: Map<string, { agendamento: string; profissional: string }>;
  relatorio: Relatorio;
  /** Ledger da fase: a gravação repõe nele a sala reaproveitada do banco. */
  ledger: Ledger;
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
  const { consultas, colisoes, origem } = planejarConsultas(exp, ctx);
  ctx.relatorio.extras.colisoes = colisoes;
  ctx.relatorio.extras.bloqueiosFuturos = bloqueiosFuturos(exp, ctx.hoje);
  if (colisoes.length) {
    ctx.relatorio.avisar(
      'consulta',
      '-',
      `${colisoes.length} sobreposições de horário do mesmo profissional (lista em "colisoes")`,
    );
  }
  return {
    salas,
    consultas,
    origem,
    relatorio: ctx.relatorio,
    ledger: ctx.ledger,
  };
}

export async function gravarAgenda(
  plano: PlanoAgenda,
  manager: EntityManager,
): Promise<void> {
  await reaproveitarSalasDoBanco(plano, manager);
  await inserirEmLotes(manager, ClinicRoom, plano.salas);
  await encaixarSobreConsultasDoBanco(plano, manager);
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

/**
 * Sala planejada com o nome de uma que a clínica já tem (criada pela tela
 * depois do cadastro, ou numa carga anterior por outro local) não é criada:
 * `uq_clinic_rooms_clinic_name_active` recusaria o INSERT e derrubaria a fase.
 * As consultas e o ledger passam a apontar para a sala existente. Roda dentro
 * da transação, logo antes do insert.
 */
async function reaproveitarSalasDoBanco(
  plano: PlanoAgenda,
  manager: EntityManager,
): Promise<void> {
  if (!plano.salas.length) return;
  const clinicas = [...new Set(plano.salas.map((s) => s.clinicId))];
  const existentes = await manager
    .getRepository(ClinicRoom)
    .createQueryBuilder('r')
    .select(['r.id', 'r.clinicId', 'r.name'])
    .where('r.clinicId IN (:...clinicas)', { clinicas })
    .andWhere('r.deletedAt IS NULL')
    .getMany();
  const porNome = new Map<string, string>();
  for (const r of existentes) {
    if (typeof r.name !== 'string') continue;
    porNome.set(`${r.clinicId}|${chaveDeSala(r.name)}`, r.id);
  }
  if (!porNome.size) return;

  const trocar = new Map<string, string>();
  plano.salas = plano.salas.filter((sala) => {
    const existente = porNome.get(`${sala.clinicId}|${chaveDeSala(sala.name)}`);
    if (!existente) return true;
    trocar.set(sala.id, existente);
    for (
      let idOrigem = plano.ledger.removerPorUuid(LEDGER_SALA, sala.id);
      idOrigem !== null;
      idOrigem = plano.ledger.removerPorUuid(LEDGER_SALA, sala.id)
    ) {
      plano.ledger.registrar(LEDGER_SALA, idOrigem, existente);
      plano.relatorio.avisar(
        'sala',
        idOrigem,
        `a clínica já tem a sala "${sala.name}": reaproveitada`,
      );
    }
    plano.relatorio.desfazerAceite('sala');
    return false;
  });
  for (const c of plano.consultas) {
    if (c.roomId && trocar.has(c.roomId)) c.roomId = trocar.get(c.roomId)!;
  }
}

/**
 * Consultas que a conta já tem na INEXCI (marcadas pela tela antes da carga)
 * também ocupam a agenda. Uma importada que cai em cima de uma delas entra
 * como encaixe — sem isso a `EX_appointments_doctor_no_overlap` derrubaria a
 * transação inteira. Roda dentro da transação da fase, logo antes do insert.
 */
async function encaixarSobreConsultasDoBanco(
  plano: PlanoAgenda,
  manager: EntityManager,
): Promise<void> {
  const ocupam = plano.consultas.filter(
    (c) => !c.isWalkIn && OCCUPYING_APPOINTMENT_STATUSES.includes(c.status),
  );
  if (!ocupam.length) return;
  const medicos = [...new Set(ocupam.map((c) => c.doctorId))];
  // Janela da carga; o início recua a duração máxima de uma consulta (480 min)
  // para pegar a existente que começou antes e ainda ocupa o horário.
  const inicios = ocupam.map((c) => c.scheduledAt.getTime());
  const de = new Date(Math.min(...inicios) - 480 * 60_000);
  const ate = new Date(
    Math.max(
      ...ocupam.map(
        (c) => c.scheduledAt.getTime() + c.durationMinutes * 60_000,
      ),
    ),
  );
  const existentes = await manager
    .getRepository(Appointment)
    .createQueryBuilder('a')
    .select(['a.doctorId', 'a.scheduledAt', 'a.durationMinutes'])
    .where({ doctorId: In(medicos) })
    .andWhere('a.status IN (:...ocupam)', {
      ocupam: OCCUPYING_APPOINTMENT_STATUSES,
    })
    .andWhere('a.scheduledAt >= :de AND a.scheduledAt < :ate', { de, ate })
    .andWhere('a.isWalkIn = false')
    .andWhere('a.deletedAt IS NULL')
    .getMany();
  if (!existentes.length) return;

  const colisoes = encaixarSobrepostas(
    plano.consultas,
    plano.origem,
    existentes,
  );
  for (const c of colisoes) {
    plano.relatorio.avisar(
      'consulta',
      c.agendamentos[1],
      'sobrepõe consulta já cadastrada na INEXCI: entrou como encaixe',
      `profissional ${c.profissional}, ${c.inicio}`,
    );
  }
}
