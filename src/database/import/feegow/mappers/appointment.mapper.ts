import {
  AppointmentStatus,
  AppointmentType,
  isActiveAppointmentStatus,
} from 'src/database/entities/appointment.entity';
import {
  dataHoraCompleta,
  dataHoraSaoPaulo,
  normalizarTexto,
} from '../../core/normalizers';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { statusDaConsulta } from '../rules/appointment-status.rule';
import { tipoDaConsulta } from '../rules/appointment-type.rule';
import { LEDGER_CLINICA } from './clinic.mapper';
import { LEDGER_CONVENIO } from './health-plan.mapper';
import { LEDGER_PACIENTE } from './patient.mapper';
import { LEDGER_FUNCIONARIO, LEDGER_PROFISSIONAL } from './team.mapper';

export const LEDGER_SALA = 'room';
export const LEDGER_CONSULTA = 'appointment';

/** Duração quando o Feegow não guardou (ou guardou lixo como "03"). */
const DURACAO_PADRAO = 30;

export interface NovaSala {
  id: string;
  ownerId: string;
  clinicId: string;
  name: string;
  active: boolean;
}

export interface NovaConsulta {
  id: string;
  ownerId: string;
  doctorId: string;
  patientId: string;
  clinicId: string | null;
  roomId: string | null;
  isWalkIn: boolean;
  healthPlanId: string | null;
  createdById: string | null;
  type: AppointmentType;
  status: AppointmentStatus;
  scheduledAt: Date;
  durationMinutes: number;
  notes: string | null;
  cancellationReason: string | null;
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Colisao {
  profissional: string;
  inicio: string;
  agendamentos: string[];
}

/**
 * Salas: os `locais` ativos do Feegow viram salas da clínica importada.
 * Exigem a clínica no ledger (fase `cadastro`).
 */
export function planejarSalas(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovaSala[] {
  const clinicId = clinicaImportada(exp, ctx);
  if (!clinicId) {
    ctx.relatorio.avisar(
      'sala',
      '-',
      'clínica não importada (rode a fase cadastro antes): consultas ficam sem clínica e sem sala',
    );
    return [];
  }
  const novas: NovaSala[] = [];
  for (const local of exp.tabela('locais')) {
    const idOrigem = local.id!;
    if (local.sys_active !== '1') continue;
    if (ctx.ledger.resolver(LEDGER_SALA, idOrigem)) {
      ctx.relatorio.pular('sala');
      continue;
    }
    const nome = normalizarTexto(local.NomeLocal, 80);
    if (!nome) {
      ctx.relatorio.rejeitar('sala', idOrigem, 'sem nome');
      continue;
    }
    const id = ctx.novoId();
    novas.push({
      id,
      ownerId: ctx.ownerId,
      clinicId,
      name: nome,
      active: true,
    });
    ctx.ledger.registrar(LEDGER_SALA, idOrigem, id);
    ctx.relatorio.aceitar('sala');
  }
  return novas;
}

/**
 * Consultas: `agendamentos` ativos com paciente e profissional importados.
 * Sem checagem de conflito (o Feegow permitia sobreposição por sala e por
 * encaixe): as sobreposições vão para o relatório.
 */
export function planejarConsultas(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): { consultas: NovaConsulta[]; colisoes: Colisao[] } {
  const rel = ctx.relatorio;
  const clinicId = clinicaImportada(exp, ctx);
  const inicioDeHoje = dataHoraSaoPaulo(ctx.hoje)!;
  const agora = new Date();

  const nomeDoStatus = new Map(
    exp.tabela('agendamento_status').map((s) => [s.id, s.nome_status]),
  );
  const nomeDoCanal = new Map(
    exp.tabela('agendamento_canais').map((c) => [c.id, c.nome_canal]),
  );
  const comAtendimento = new Set(
    exp
      .tabela('atendimentos')
      .map((a) => a.agendamento_id)
      .filter((id): id is string => !!id && id !== '0'),
  );
  const autorPorUsuario = new Map(
    exp.tabela('usuarios').map((u) => {
      const tipo = (u.tipo_usuario ?? '').toLowerCase();
      const entidade =
        tipo === 'profissionais'
          ? LEDGER_PROFISSIONAL
          : tipo === 'funcionarios'
            ? LEDGER_FUNCIONARIO
            : null;
      return [
        u.id,
        entidade ? ctx.ledger.resolver(entidade, u.id_relativo) : null,
      ];
    }),
  );

  const consultas: NovaConsulta[] = [];
  // uuid gerado → ids do Feegow, para o relatório falar a língua do cliente.
  const origem = new Map<
    string,
    { agendamento: string; profissional: string }
  >();
  for (const a of exp.tabela('agendamentos')) {
    const idOrigem = a.id!;
    if (a.sys_active !== '1') continue; // -1 = excluído no Feegow
    if (ctx.ledger.resolver(LEDGER_CONSULTA, idOrigem)) {
      rel.pular('consulta');
      continue;
    }
    if (!a.paciente_id) {
      rel.rejeitar('consulta', idOrigem, 'sem paciente (reserva de horário)');
      continue;
    }
    const patientId = ctx.ledger.resolver(LEDGER_PACIENTE, a.paciente_id);
    if (!patientId) {
      rel.rejeitar('consulta', idOrigem, 'paciente não importado');
      continue;
    }
    const doctorId = ctx.ledger.resolver(
      LEDGER_PROFISSIONAL,
      a.profissional_id,
    );
    if (!doctorId) {
      rel.rejeitar('consulta', idOrigem, 'profissional não importado');
      continue;
    }
    const inicio = dataHoraSaoPaulo(a.Data, a.Hora);
    if (!inicio) {
      rel.rejeitar('consulta', idOrigem, 'data ou hora inválida');
      continue;
    }

    const passada = inicio < inicioDeHoje;
    const status = statusDaConsulta({
      statusId: a.status_id,
      nomeDoStatus: nomeDoStatus.get(a.status_id ?? '') ?? null,
      temAtendimento: comAtendimento.has(idOrigem),
      passada,
      passadasSemAtendimento: ctx.opcoes.passadasSemAtendimento,
    });
    if (!status) {
      rel.rejeitar(
        'consulta',
        idOrigem,
        `status desconhecido (${a.status_id ?? 'vazio'})`,
      );
      continue;
    }

    const tempo = Number(a.tempo);
    const duracao =
      Number.isInteger(tempo) && tempo >= 5 && tempo <= 480
        ? tempo
        : DURACAO_PADRAO;
    if (a.tempo && duracao !== tempo) {
      rel.avisar(
        'consulta',
        idOrigem,
        `duração inválida no Feegow, usado ${DURACAO_PADRAO} min`,
        `tempo=${a.tempo}`,
      );
    }

    const canal = nomeDoCanal.get(a.canal_id ?? '');
    const notas = [canal ? `[${canal}]` : null, (a.Notas ?? '').trim() || null]
      .filter(Boolean)
      .join(' ');

    const criadoEm = dataHoraCompleta(a.sys_date) ?? inicio;
    const futuraAtiva = !passada && isActiveAppointmentStatus(status.status);
    const id = ctx.novoId();
    consultas.push({
      id,
      ownerId: ctx.ownerId,
      doctorId,
      patientId,
      clinicId,
      roomId: clinicId ? ctx.ledger.resolver(LEDGER_SALA, a.local_id) : null,
      isWalkIn: a.is_encaixe === '1',
      healthPlanId: ctx.ledger.resolver(LEDGER_CONVENIO, a.convenio_id),
      createdById: autorPorUsuario.get(a.usuario_id ?? '') ?? null,
      type: tipoDaConsulta({
        primeiraVez: a.is_primeira_vez,
        procedimentoId: a.procedimento_id,
        profissionalId: a.profissional_id,
      }),
      status: status.status,
      scheduledAt: inicio,
      durationMinutes: duracao,
      notes: notas || null,
      cancellationReason: status.cancellationReason,
      // Consulta futura: o lembrete é do Feegow, não da INEXCI (salvo
      // `--lembretes`). Passada: irrelevante, o cron só olha as próximas 24h.
      reminderSentAt: futuraAtiva && !ctx.opcoes.lembretes ? agora : null,
      createdAt: criadoEm,
      updatedAt: criadoEm,
    });
    ctx.ledger.registrar(LEDGER_CONSULTA, idOrigem, id);
    origem.set(id, { agendamento: idOrigem, profissional: a.profissional_id! });
    rel.aceitar('consulta');
    if (futuraAtiva) rel.aceitar('consulta futura (ativa)');
  }

  return { consultas, colisoes: colisoesEntre(consultas, origem) };
}

function clinicaImportada(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): string | null {
  const unidade = exp.tabela('unidades')[0];
  return ctx.ledger.resolver(LEDGER_CLINICA, unidade?.id ?? '0');
}

/**
 * Sobreposições do mesmo profissional entre consultas que ocupam a agenda e
 * não são encaixe — o que a INEXCI recusaria ao agendar pela tela. Não
 * bloqueia a importação; vai para o relatório.
 */
function colisoesEntre(
  consultas: NovaConsulta[],
  origem: Map<string, { agendamento: string; profissional: string }>,
): Colisao[] {
  const porMedico = new Map<string, NovaConsulta[]>();
  for (const c of consultas) {
    if (c.isWalkIn || !isActiveAppointmentStatus(c.status)) continue;
    porMedico.set(c.doctorId, [...(porMedico.get(c.doctorId) ?? []), c]);
  }

  const colisoes: Colisao[] = [];
  for (const [medico, lista] of porMedico) {
    lista.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    let fimAnterior = 0;
    let anterior: NovaConsulta | null = null;
    for (const c of lista) {
      const inicio = c.scheduledAt.getTime();
      if (anterior && inicio < fimAnterior) {
        colisoes.push({
          profissional: origem.get(c.id)?.profissional ?? medico,
          inicio: c.scheduledAt.toISOString(),
          agendamentos: [anterior.id, c.id].map(
            (id) => origem.get(id)?.agendamento ?? id,
          ),
        });
      }
      const fim = inicio + c.durationMinutes * 60_000;
      if (fim > fimAnterior) {
        fimAnterior = fim;
        anterior = c;
      }
    }
  }
  return colisoes;
}
