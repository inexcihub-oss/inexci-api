import {
  dataHoraCompleta,
  dataHoraSaoPaulo,
  normalizarData,
} from '../../core/normalizers';
import { chaveDeNome, ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { clinicaImportada, LEDGER_SALA } from './appointment.mapper';
import { autoresDoFeegow, LEDGER_PROFISSIONAL } from './team.mapper';

export const LEDGER_GRADE = 'schedule';
export const LEDGER_BLOQUEIO = 'block';
export const LEDGER_FERIADO = 'holiday';

const INTERVALO_PADRAO = 30;

const MAX_DIAS_BLOQUEIO_POR_DIA = 366;

const FERIADOS_MOVEIS = [
  'carnaval',
  'cinzas',
  'paixao',
  'sexta-feira santa',
  'sexta feira santa',
  'pascoa',
  'corpus christi',
];

export interface NovaGrade {
  id: string;
  ownerId: string;
  doctorId: string;
  clinicId: string | null;
  roomId: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  maxWalkIns: number | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoBloqueio {
  id: string;
  ownerId: string;
  doctorId: string | null;
  clinicId: null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoFeriado {
  id: string;
  ownerId: string;
  name: string;
  date: string;
  recurring: boolean;
  blocksAgenda: boolean;
}

const marcado = (valor: string | null | undefined) =>
  (valor ?? '').includes('|1|');

const hora = (v: string | null | undefined) =>
  /^\d{2}:\d{2}(:\d{2})?$/.test((v ?? '').trim())
    ? `${v!.trim().slice(0, 5)}:00`
    : null;

const diasEntre = (de: string, ate: string): string[] => {
  const dias: string[] = [];
  for (
    let t = Date.parse(`${de}T12:00:00Z`);
    t <= Date.parse(`${ate}T12:00:00Z`);
    t += 86_400_000
  ) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
};

const minutos = (h: string) => {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
};

export function planejarGrades(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovaGrade[] {
  const rel = ctx.relatorio;
  const clinicId = clinicaImportada(exp, ctx);
  const grades: GradePlanejada[] = [];

  const linhas: {
    chave: string;
    ordem: number;
    profissional: string | null;
    weekdays: number[];
    de: string | null;
    ate: string | null;
    local: string | null;
    intervalo: string | null;
    encaixes: string | null;
    vigenciaDe: string | null;
    vigenciaAte: string | null;
    criadoEm: string | null;
  }[] = [];

  for (const g of exp.tabela('grade_fixa')) {
    if (g.profissionalid === '-1') continue;
    const dia = Number(g.dia_semana);
    linhas.push({
      chave: `fixa:${g.id}`,
      ordem: Number(g.id) || 0,
      profissional: g.profissionalid,
      weekdays: dia >= 1 && dia <= 7 ? [dia - 1] : [],
      de: g.hora_de,
      ate: g.hora_ate,
      local: g.localid,
      intervalo: g.intervalo,
      encaixes: g.maximo_encaixes,
      vigenciaDe: normalizarData(g.inicio_vigencia),
      vigenciaAte: normalizarData(g.fim_vigencia),
      criadoEm: g.datahora,
    });
  }
  for (const g of exp.tabela('grade_periodo')) {
    const de = normalizarData(g.data_de);
    const ate = normalizarData(g.data_ate) ?? de;
    const weekdays = new Set<number>();
    if (de && ate) {
      for (
        let t = Date.parse(`${de}T12:00:00Z`);
        t <= Date.parse(`${ate}T12:00:00Z`) && weekdays.size < 7;
        t += 86_400_000
      ) {
        weekdays.add(new Date(t).getUTCDay());
      }
    }
    linhas.push({
      chave: `periodo:${g.id}`,
      ordem: 1_000_000 + (Number(g.id) || 0),
      profissional: g.profissional_id,
      weekdays: [...weekdays].sort(),
      de: g.hora_de,
      ate: g.hora_ate,
      local: g.local_id,
      intervalo: g.intervalo,
      encaixes: g.maximo_encaixes,
      vigenciaDe: de,
      vigenciaAte: ate,
      criadoEm: g.datahora,
    });
  }

  for (const l of linhas) {
    if (
      ctx.ledger.resolver(LEDGER_GRADE, `${l.chave}:${l.weekdays[0] ?? 'x'}`)
    ) {
      rel.pular('grade');
      continue;
    }
    const doctorId = ctx.ledger.resolver(LEDGER_PROFISSIONAL, l.profissional);
    if (!doctorId) {
      rel.rejeitar('grade', l.chave, 'profissional não importado');
      continue;
    }
    const inicio = hora(l.de);
    const fim = hora(l.ate);
    if (
      !l.weekdays.length ||
      !inicio ||
      !fim ||
      minutos(inicio) >= minutos(fim)
    ) {
      rel.rejeitar('grade', l.chave, 'dia ou horário inválido');
      continue;
    }
    let slot = Number(l.intervalo);
    if (!Number.isInteger(slot) || slot < 5 || slot > 240) {
      rel.avisar(
        'grade',
        l.chave,
        `intervalo inválido (${l.intervalo ?? 'vazio'}), usado ${INTERVALO_PADRAO} min`,
      );
      slot = INTERVALO_PADRAO;
    }
    if (minutos(fim) - minutos(inicio) < slot) {
      rel.avisar(
        'grade',
        l.chave,
        'período menor que o intervalo: intervalo ajustado ao período',
      );
      slot = Math.max(5, minutos(fim) - minutos(inicio));
    }
    const encaixes = Number(l.encaixes);
    const cadastro = dataHoraCompleta(l.criadoEm);
    const criadoEm = cadastro ?? new Date();
    for (const weekday of l.weekdays) {
      grades.push({
        id: ctx.novoId(),
        ownerId: ctx.ownerId,
        doctorId,
        clinicId,
        roomId: clinicId ? ctx.ledger.resolver(LEDGER_SALA, l.local) : null,
        weekday,
        startTime: inicio,
        endTime: fim,
        slotMinutes: slot,
        maxWalkIns:
          l.encaixes && Number.isInteger(encaixes) && encaixes >= 0
            ? Math.min(encaixes, 50)
            : null,
        validFrom: l.vigenciaDe,
        validTo: l.vigenciaAte,
        active: !l.vigenciaAte || l.vigenciaAte >= ctx.hoje,
        createdAt: criadoEm,
        updatedAt: criadoEm,
        origem: `${l.chave}:${weekday}`,
        ordem: l.ordem,
        cadastro: cadastro?.getTime() ?? 0,
      });
    }
  }

  resolverSobreposicoes(grades, ctx);

  return grades.map(({ origem, ordem: _o, cadastro: _c, ...g }) => {
    ctx.ledger.registrar(LEDGER_GRADE, origem, g.id);
    rel.aceitar('grade');
    return g;
  });
}

type GradePlanejada = NovaGrade & {
  origem: string;
  ordem: number;
  cadastro: number;
};

const diaAnterior = (data: string) =>
  new Date(Date.parse(`${data}T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);

function resolverSobreposicoes(
  grades: GradePlanejada[],
  ctx: ContextoImportacao,
): void {
  const rel = ctx.relatorio;
  const recentesPrimeiro = [...grades].sort(
    (a, b) => b.cadastro - a.cadastro || b.ordem - a.ordem,
  );
  const sobrepoe = (a: GradePlanejada, b: GradePlanejada) =>
    a.active &&
    b.active &&
    a.doctorId === b.doctorId &&
    a.weekday === b.weekday &&
    minutos(a.startTime) < minutos(b.endTime) &&
    minutos(b.startTime) < minutos(a.endTime) &&
    (!a.validTo || !b.validFrom || b.validFrom <= a.validTo) &&
    (!b.validTo || !a.validFrom || a.validFrom <= b.validTo);
  const faixa = (g: GradePlanejada) =>
    `${g.startTime.slice(0, 5)}–${g.endTime.slice(0, 5)}`;

  for (const [i, g] of recentesPrimeiro.entries()) {
    for (const o of recentesPrimeiro.slice(0, i)) {
      if (!g.active) break;
      if (!sobrepoe(o, g)) continue;

      if (!o.validTo && !g.validTo && o.validFrom !== g.validFrom) {
        const [antiga, nova] =
          (o.validFrom ?? '') < (g.validFrom ?? '') ? [o, g] : [g, o];
        antiga.validTo = diaAnterior(nova.validFrom!);
        antiga.active = antiga.validTo >= ctx.hoje;
        rel.avisar(
          'grade',
          antiga.origem,
          `substituída por ${nova.origem} (${faixa(nova)}) a partir de ${nova.validFrom}: vigência encerrada em ${antiga.validTo}${antiga.active ? '' : ', entra inativa'}`,
        );
        continue;
      }

      const perde = !o.validTo !== !g.validTo ? (o.validTo ? o : g) : g;
      const fica = perde === g ? o : g;
      perde.active = false;
      rel.avisar(
        'grade',
        perde.origem,
        `sobrepõe ${fica.origem} (${faixa(fica)}): entra inativa para revisão`,
      );
    }
  }
}

const NOMES_DIA_FEEGOW: Record<string, string> = {
  '1': 'domingo',
  '2': 'segunda',
  '3': 'terça',
  '4': 'quarta',
  '5': 'quinta',
  '6': 'sexta',
  '7': 'sábado',
};

export function diasDaSemanaDoBloqueio(
  texto: string | null | undefined,
): string[] {
  const dias = new Set((texto ?? '').match(/[1-7]/g) ?? []);
  return [...dias].sort().map((d) => NOMES_DIA_FEEGOW[d]);
}

export function planejarBloqueios(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoBloqueio[] {
  const rel = ctx.relatorio;
  const autores = autoresDoFeegow(exp, ctx);
  const novos: NovoBloqueio[] = [];
  let deFeriado = 0;
  let passados = 0;

  for (const b of exp.tabela('agenda_bloqueios')) {
    const idOrigem = b.id!;
    if (b.FeriadoID && b.FeriadoID !== '0') {
      deFeriado++;
      continue;
    }
    if (ctx.ledger.resolver(LEDGER_BLOQUEIO, idOrigem)) {
      rel.pular('bloqueio');
      continue;
    }
    const dataDe = normalizarData(b.DataDe);
    const dataAte = normalizarData(b.DataA) ?? dataDe;
    if (!dataDe || !dataAte) {
      const dias = diasDaSemanaDoBloqueio(b.DiasSemana);
      const recorrente = !b.DataDe?.trim() && !b.DataA?.trim() && dias.length;
      const de = hora(b.HoraDe)?.slice(0, 5);
      const ate = hora(b.HoraA)?.slice(0, 5);
      const quando = [dias.join(', '), de && ate ? `${de}–${ate}` : null]
        .filter(Boolean)
        .join(', ');
      const motivo = recorrente
        ? `bloqueio recorrente sem data (${quando}) — a INEXCI não tem bloqueio recorrente: recriar manualmente`
        : 'data inválida';
      rel.rejeitar('bloqueio', idOrigem, motivo);
      continue;
    }
    if (ctx.opcoes.bloqueiosSoFuturos && dataAte < ctx.hoje) {
      passados++;
      continue;
    }

    let doctorId: string | null = null;
    if (b.ProfissionalID && b.ProfissionalID !== '0') {
      doctorId = ctx.ledger.resolver(LEDGER_PROFISSIONAL, b.ProfissionalID);
      if (!doctorId) {
        rel.rejeitar('bloqueio', idOrigem, 'profissional não importado');
        continue;
      }
    }

    const horaDe = hora(b.HoraDe) ?? '00:00:00';
    const horaAte = hora(b.HoraA);
    const allDay = horaDe === '00:00:00' && (!horaAte || horaAte >= '23:59:00');
    const fimDoDia = horaAte ?? '23:59:59';

    const porDia = !allDay && dataAte > dataDe && horaDe < fimDoDia;
    let intervalos: { dia: string | null; startsAt: Date; endsAt: Date }[];
    if (porDia) {
      const dias = diasEntre(dataDe, dataAte);
      if (dias.length > MAX_DIAS_BLOQUEIO_POR_DIA) {
        rel.rejeitar(
          'bloqueio',
          idOrigem,
          `janela de horário repetida por ${dias.length} dias (máximo ${MAX_DIAS_BLOQUEIO_POR_DIA}): recrie na INEXCI`,
        );
        continue;
      }
      intervalos = dias
        .filter((dia) => !ctx.opcoes.bloqueiosSoFuturos || dia >= ctx.hoje)
        .map((dia) => ({
          dia,
          startsAt: dataHoraSaoPaulo(dia, horaDe)!,
          endsAt: dataHoraSaoPaulo(dia, fimDoDia)!,
        }));
    } else {
      intervalos = [
        {
          dia: null,
          startsAt: dataHoraSaoPaulo(dataDe, allDay ? '00:00:00' : horaDe)!,
          endsAt: allDay
            ? dataHoraSaoPaulo(diaSeguinte(dataAte), '00:00:00')!
            : dataHoraSaoPaulo(dataAte, fimDoDia)!,
        },
      ];
    }
    if (!intervalos.every((i) => i.startsAt < i.endsAt)) {
      rel.rejeitar(
        'bloqueio',
        idOrigem,
        'duração zero ou fim antes do início (sem efeito no Feegow)',
      );
      continue;
    }

    const titulo = (b.Titulo ?? '').trim();
    const descricao = (b.Descricao ?? '').trim();
    const motivo =
      [titulo, descricao && descricao !== titulo ? descricao : '']
        .filter(Boolean)
        .join(' — ')
        .slice(0, 200) || null;
    const createdById = autores.get(b.Usuario ?? '') ?? null;
    for (const [n, { dia, startsAt, endsAt }] of intervalos.entries()) {
      const criadoEm = dataHoraCompleta(b.DHUp) ?? startsAt;
      const id = ctx.novoId();
      novos.push({
        id,
        ownerId: ctx.ownerId,
        doctorId,
        clinicId: null,
        startsAt,
        endsAt,
        allDay,
        reason: motivo,
        createdById,
        createdAt: criadoEm,
        updatedAt: criadoEm,
      });
      if (n === 0) ctx.ledger.registrar(LEDGER_BLOQUEIO, idOrigem, id);
      if (dia) ctx.ledger.registrar(LEDGER_BLOQUEIO, `${idOrigem}:${dia}`, id);
      rel.aceitar('bloqueio');
    }
  }
  if (deFeriado) {
    rel.avisar(
      'bloqueio',
      '-',
      `${deFeriado} bloqueios gerados por feriado ignorados (o feriado já bloqueia)`,
    );
  }
  if (passados) {
    rel.avisar(
      'bloqueio',
      '-',
      `${passados} bloqueios passados ignorados (--bloqueios-so-futuros)`,
    );
  }
  return novos;
}

export function planejarFeriados(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoFeriado[] {
  const rel = ctx.relatorio;
  const novos: NovoFeriado[] = [];
  let inativos = 0;
  for (const f of exp.tabela('feriados')) {
    const idOrigem = f.id!;
    if (f.sys_active === '-1') continue;
    if (f.sys_active !== '1') {
      inativos++;
      continue;
    }
    if (ctx.ledger.resolver(LEDGER_FERIADO, idOrigem)) {
      rel.pular('feriado');
      continue;
    }
    const nome = (f.nome_feriado ?? '').trim().slice(0, 100);
    const data = normalizarData(f.data);
    if (!nome || !data) {
      rel.avisar(
        'feriado',
        idOrigem,
        `sem data no Feegow (${nome || 'sem nome'}): não importado`,
      );
      continue;
    }
    let recurring = marcado(f.recorrente);
    if (
      recurring &&
      FERIADOS_MOVEIS.some((m) => chaveDeNome(nome).includes(m))
    ) {
      recurring = false;
      rel.avisar(
        'feriado',
        idOrigem,
        `${nome} muda de data todo ano: importado só para ${data}, sem repetir`,
      );
    }
    const id = ctx.novoId();
    novos.push({
      id,
      ownerId: ctx.ownerId,
      name: nome,
      date: data,
      recurring,
      blocksAgenda: marcado(f.bloquear_agenda),
    });
    ctx.ledger.registrar(LEDGER_FERIADO, idOrigem, id);
    rel.aceitar('feriado');
  }
  if (inativos) {
    rel.avisar(
      'feriado',
      '-',
      `${inativos} feriados inativos no Feegow não importados`,
    );
  }
  return novos;
}

function diaSeguinte(data: string): string {
  return new Date(Date.parse(`${data}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
