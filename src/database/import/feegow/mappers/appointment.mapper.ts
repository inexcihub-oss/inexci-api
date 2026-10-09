import {
  AppointmentStatus,
  AppointmentType,
  isActiveAppointmentStatus,
  OCCUPYING_APPOINTMENT_STATUSES,
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
import { autoresDoFeegow, LEDGER_PROFISSIONAL } from './team.mapper';

export const LEDGER_SALA = 'room';
export const LEDGER_CONSULTA = 'appointment';

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

export function chaveDeSala(nome: string): string {
  return nome.trim().toLowerCase();
}

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
  const porNome = new Map<string, { id: string; local: string }>();
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
    const mesmaSala = porNome.get(chaveDeSala(nome));
    if (mesmaSala) {
      ctx.ledger.registrar(LEDGER_SALA, idOrigem, mesmaSala.id);
      ctx.relatorio.avisar(
        'sala',
        idOrigem,
        `mesmo nome do local ${mesmaSala.local} ("${nome}"): as consultas dos dois usam a mesma sala`,
      );
      continue;
    }
    const id = ctx.novoId();
    porNome.set(chaveDeSala(nome), { id, local: idOrigem });
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

export function planejarConsultas(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): {
  consultas: NovaConsulta[];
  colisoes: Colisao[];
  origem: Map<string, { agendamento: string; profissional: string }>;
} {
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
  const nomeDoProcedimento = new Map(
    exp
      .tabela('procedimentos')
      .map((pr) => [pr.id, nomeDeProcedimento(pr.nome_procedimento)]),
  );
  const comAtendimento = new Set(
    exp
      .tabela('atendimentos')
      .map((a) => a.agendamento_id)
      .filter((id): id is string => !!id && id !== '0'),
  );
  const autorPorUsuario = autoresDoFeegow(exp, ctx);

  const consultas: NovaConsulta[] = [];
  const origem = new Map<
    string,
    { agendamento: string; profissional: string }
  >();
  for (const a of exp.tabela('agendamentos')) {
    const idOrigem = a.id!;
    if (a.sys_active !== '1') continue;
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
    const procedimento = nomeDoProcedimento.get(a.procedimento_id ?? '');
    const notas = [
      [canal ? `[${canal}]` : null, (a.Notas ?? '').trim() || null]
        .filter(Boolean)
        .join(' '),
      procedimento ? `Procedimento no Feegow: ${procedimento}` : null,
    ]
      .filter(Boolean)
      .join('\n');

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
        convenioId: a.convenio_id,
      }),
      status: status.status,
      scheduledAt: inicio,
      durationMinutes: duracao,
      notes: notas || null,
      cancellationReason: status.cancellationReason,
      reminderSentAt:
        passada || (futuraAtiva && ctx.opcoes.semLembretes) ? agora : null,
      createdAt: criadoEm,
      updatedAt: criadoEm,
    });
    ctx.ledger.registrar(LEDGER_CONSULTA, idOrigem, id);
    origem.set(id, { agendamento: idOrigem, profissional: a.profissional_id! });
    rel.aceitar('consulta');
    if (futuraAtiva) rel.aceitar('consulta futura (ativa)');
  }

  return {
    consultas,
    colisoes: encaixarSobrepostas(consultas, origem),
    origem,
  };
}

export function nomeDeProcedimento(
  nome: string | null | undefined,
): string | null {
  const limpo = (nome ?? '')
    .replace(/^['"\s]+|['"\s]+$/g, '')
    .replace(/\s+/g, ' ');
  return /\p{L}{2}/u.test(limpo) ? limpo : null;
}

export function clinicaImportada(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): string | null {
  const unidade = exp.tabela('unidades')[0];
  return ctx.ledger.resolver(LEDGER_CLINICA, unidade?.id ?? '0');
}

export interface HorarioOcupado {
  doctorId: string;
  scheduledAt: Date;
  durationMinutes: number;
}

export function encaixarSobrepostas(
  consultas: NovaConsulta[],
  origem: Map<string, { agendamento: string; profissional: string }>,
  ocupados: HorarioOcupado[] = [],
): Colisao[] {
  type Item = { c: NovaConsulta | null; inicio: number; fim: number };
  const porMedico = new Map<string, Item[]>();
  const incluir = (doctorId: string, item: Item) =>
    porMedico.set(doctorId, [...(porMedico.get(doctorId) ?? []), item]);
  for (const o of ocupados) {
    const inicio = o.scheduledAt.getTime();
    incluir(o.doctorId, {
      c: null,
      inicio,
      fim: inicio + o.durationMinutes * 60_000,
    });
  }
  for (const c of consultas) {
    if (c.isWalkIn || !OCCUPYING_APPOINTMENT_STATUSES.includes(c.status))
      continue;
    const inicio = c.scheduledAt.getTime();
    incluir(c.doctorId, {
      c,
      inicio,
      fim: inicio + c.durationMinutes * 60_000,
    });
  }

  const colisoes: Colisao[] = [];
  for (const [medico, lista] of porMedico) {
    const existentes = lista.filter((i) => !i.c);
    const importadas = lista
      .filter((i) => i.c)
      .sort((a, b) => a.inicio - b.inicio);
    const encaixar = (item: Item, anterior: Item | null) => {
      const c = item.c as NovaConsulta;
      c.isWalkIn = true;
      colisoes.push({
        profissional: origem.get(c.id)?.profissional ?? medico,
        inicio: c.scheduledAt.toISOString(),
        agendamentos: [anterior?.c?.id ?? null, c.id].map((id) =>
          id ? (origem.get(id)?.agendamento ?? id) : 'já na INEXCI',
        ),
      });
    };

    const restantes: Item[] = [];
    for (const item of importadas) {
      const existente = existentes.find(
        (e) => item.inicio < e.fim && e.inicio < item.fim,
      );
      if (existente) encaixar(item, existente);
      else restantes.push(item);
    }

    let fimAnterior = 0;
    let anterior: Item | null = null;
    for (const item of restantes) {
      if (anterior && item.inicio < fimAnterior) {
        encaixar(item, anterior);
        continue;
      }
      if (item.fim > fimAnterior) {
        fimAnterior = item.fim;
        anterior = item;
      }
    }
  }
  return colisoes;
}
