import { LinhaCsv } from '../../core/csv';
import { htmlSemTexto, sanitizarHtmlClinico } from '../../core/html';
import { dataHoraCompleta, dataHoraSaoPaulo } from '../../core/normalizers';
import { chaveDeNome, ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  ConteudoFicha,
  conteudoDaFicha,
  FormularioFeegow,
  MODELO_RESUMO_IA,
  textoComparavel,
} from '../rules/clinical-content.rule';
import { LEDGER_CONSULTA } from './appointment.mapper';
import { LEDGER_PACIENTE } from './patient.mapper';
import { LEDGER_PROFISSIONAL, profissionaisDoFeegow } from './team.mapper';

export const LEDGER_FICHA = 'clinical_record';
export const LEDGER_MODELO_ANAMNESE = 'clinical_record_template';

const NOME_RESUMO_IA = 'Resumo da consulta (gerado por IA no Feegow)';

export interface NovaFicha extends ConteudoFicha {
  id: string;
  ownerId: string;
  doctorId: string;
  patientId: string;
  appointmentId: string | null;
  cidCodes: null;
  surgicalIndication: false;
  finalizedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovoModeloAnamnese {
  id: string;
  ownerId: string;
  doctorId: string;
  name: string;
}

interface FormularioLido extends FormularioFeegow {
  id: string;
  pacienteId: string | null;
  atendimentoId: string | null;
  profissionalId: string | null;
}

export function planejarFichas(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovaFicha[] {
  const rel = ctx.relatorio;
  const profissionais = profissionaisDoFeegow(exp, ctx);
  const formularios = lerFormularios(exp, ctx);

  const porAtendimento = new Map<string, FormularioLido[]>();
  const atendimentosExistentes = new Set(
    exp.tabela('atendimentos').map((a) => a.id),
  );
  const soltos: FormularioLido[] = [];
  for (const f of formularios) {
    if (f.atendimentoId && atendimentosExistentes.has(f.atendimentoId)) {
      porAtendimento.set(f.atendimentoId, [
        ...(porAtendimento.get(f.atendimentoId) ?? []),
        f,
      ]);
    } else {
      soltos.push(f);
    }
  }

  const textosDoPaciente = new Map<string, Set<string>>();
  for (const f of formularios) {
    if (!f.pacienteId) continue;
    const textos = textosDoPaciente.get(f.pacienteId) ?? new Set<string>();
    textos.add(textoComparavel(f.conteudo));
    textosDoPaciente.set(f.pacienteId, textos);
  }
  const resumosPorAtendimento = new Map<string, LinhaCsv[]>();
  const resumosSoltos: LinhaCsv[] = [];
  let resumosRepetidos = 0;
  for (const r of exp.tabela('pacientes_ai_summary')) {
    if (r.sys_active !== '1' || htmlSemTexto(r.conteudo)) continue;
    const texto = textoComparavel(r.conteudo ?? '');
    if (textosDoPaciente.get(r.paciente_id ?? '')?.has(texto)) {
      resumosRepetidos++;
      continue;
    }
    if (r.atendimento_id && atendimentosExistentes.has(r.atendimento_id)) {
      resumosPorAtendimento.set(r.atendimento_id, [
        ...(resumosPorAtendimento.get(r.atendimento_id) ?? []),
        r,
      ]);
    } else {
      resumosSoltos.push(r);
    }
  }
  if (resumosRepetidos) {
    rel.avisar(
      'ficha',
      '-',
      `${resumosRepetidos} resumos de IA ignorados: o mesmo texto já está no formulário do atendimento`,
    );
  }

  const fichas: NovaFicha[] = [];
  const consultasUsadas = new Set<string>(ctx.consultasComFicha);
  let paraODono = 0;
  const nova = (dados: {
    chave: string;
    pacienteOrigem: string | null | undefined;
    doctorId: string;
    appointmentId: string | null;
    conteudo: ConteudoFicha;
    criadaEm: Date;
    finalizadaEm: Date;
  }) => {
    if (ctx.ledger.resolver(LEDGER_FICHA, dados.chave)) {
      rel.pular('ficha');
      return;
    }
    const patientId = ctx.ledger.resolver(
      LEDGER_PACIENTE,
      dados.pacienteOrigem,
    );
    if (!patientId) {
      rel.rejeitar('ficha', dados.chave, 'paciente não importado');
      return;
    }
    if (dados.doctorId === ctx.ownerId) paraODono++;
    const id = ctx.novoId();
    fichas.push({
      id,
      ownerId: ctx.ownerId,
      doctorId: dados.doctorId,
      patientId,
      appointmentId: dados.appointmentId,
      ...dados.conteudo,
      cidCodes: null,
      surgicalIndication: false,
      finalizedAt: dados.finalizadaEm,
      createdAt: dados.criadaEm,
      updatedAt: dados.finalizadaEm,
    });
    ctx.ledger.registrar(LEDGER_FICHA, dados.chave, id);
    rel.aceitar('ficha');
  };

  const atendimentos = exp
    .tabela('atendimentos')
    .map((a) => ({
      a,
      inicio: dataHoraSaoPaulo(a.DATA, a.hora_inicio),
      fim: dataHoraSaoPaulo(a.DATA, a.hora_fim),
    }))
    .sort((x, y) => (x.inicio?.getTime() ?? 0) - (y.inicio?.getTime() ?? 0));
  const agendamentos = new Map(
    exp.tabela('agendamentos').map((g) => [g.id, g]),
  );
  let semFormulario = 0;
  for (const { a, inicio, fim } of atendimentos) {
    const chave = `atd:${a.id}`;
    if (!inicio) {
      rel.rejeitar('ficha', chave, 'data do atendimento inválida');
      continue;
    }
    const doctorId =
      ctx.ledger.resolver(LEDGER_PROFISSIONAL, a.profissional_id) ??
      profissionais.get(a.sys_user ?? '') ??
      ctx.ownerId;
    let appointmentId = ctx.ledger.resolver(LEDGER_CONSULTA, a.agendamento_id);
    if (appointmentId && !ctx.ledger.resolver(LEDGER_FICHA, chave)) {
      const g = agendamentos.get(a.agendamento_id);
      const pacienteDaFicha = ctx.ledger.resolver(
        LEDGER_PACIENTE,
        a.paciente_id,
      );
      const mesmoPaciente =
        !!g &&
        ctx.ledger.resolver(LEDGER_PACIENTE, g.paciente_id) === pacienteDaFicha;
      const mesmoMedico =
        !!g &&
        ctx.ledger.resolver(LEDGER_PROFISSIONAL, g.profissional_id) ===
          doctorId;
      if (pacienteDaFicha && (!mesmoPaciente || !mesmoMedico)) {
        appointmentId = null;
        rel.avisar(
          'ficha',
          chave,
          `agendamento ${a.agendamento_id} é de outro ${mesmoPaciente ? 'profissional' : 'paciente'}: ficha sem consulta`,
        );
      }
    }
    if (
      appointmentId &&
      consultasUsadas.has(appointmentId) &&
      !ctx.ledger.resolver(LEDGER_FICHA, chave)
    ) {
      rel.avisar(
        'ficha',
        chave,
        ctx.consultasComFicha.has(appointmentId)
          ? 'consulta já tem ficha na INEXCI: ficha sem consulta'
          : 'segundo atendimento do mesmo agendamento: ficha sem consulta',
      );
      appointmentId = null;
    }
    const doFormulario = porAtendimento.get(a.id!) ?? [];
    const resumos = (resumosPorAtendimento.get(a.id!) ?? []).map((r) =>
      resumoComoFormulario(r, inicio),
    );
    if (!doFormulario.length && !resumos.length) semFormulario++;
    const tamanhoAntes = fichas.length;
    nova({
      chave,
      pacienteOrigem: a.paciente_id,
      doctorId,
      appointmentId,
      conteudo: conteudoDaFicha(
        [...doFormulario, ...resumos],
        ctx.opcoes.caixaLivre,
      ),
      criadaEm: inicio,
      finalizadaEm: fim && fim >= inicio ? fim : inicio,
    });
    if (appointmentId && fichas.length > tamanhoAntes)
      consultasUsadas.add(appointmentId);
  }
  if (semFormulario) {
    rel.avisar(
      'ficha',
      '-',
      `${semFormulario} atendimentos sem formulário viram fichas vazias (o atendimento aconteceu)`,
    );
  }

  for (const f of soltos) {
    nova({
      chave: `form:${f.id}`,
      pacienteOrigem: f.pacienteId,
      doctorId:
        ctx.ledger.resolver(LEDGER_PROFISSIONAL, f.profissionalId) ??
        ctx.ownerId,
      appointmentId: null,
      conteudo: conteudoDaFicha([f], ctx.opcoes.caixaLivre),
      criadaEm: f.quando,
      finalizadaEm: f.quando,
    });
  }

  for (const r of resumosSoltos) {
    const quando = dataHoraCompleta(r.data) ?? null;
    if (!quando) {
      rel.rejeitar('ficha', `ia:${r.id}`, 'data do resumo inválida');
      continue;
    }
    nova({
      chave: `ia:${r.id}`,
      pacienteOrigem: r.paciente_id,
      doctorId: profissionais.get(r.sys_user ?? '') ?? ctx.ownerId,
      appointmentId: null,
      conteudo: conteudoDaFicha(
        [resumoComoFormulario(r, quando)],
        ctx.opcoes.caixaLivre,
      ),
      criadaEm: quando,
      finalizadaEm: quando,
    });
  }

  const vistosNoInstante = new Map<string, number>();
  const legadasUsadas = new Set<string>();
  for (const p of exp.tabela(
    'prescricao_atestados_diagnosticos_pedidosexames',
  )) {
    const quando = dataHoraCompleta(p.datahora);
    const tipo = (p.tipo ?? 'Documento').trim();
    const chave = chaveDoDocumentoEmitido(p, tipo, vistosNoInstante);
    if (!quando || htmlSemTexto(p.conteudo)) {
      rel.rejeitar('ficha', chave, 'documento emitido sem data ou sem texto');
      continue;
    }
    const legada = `presc:${p.PacienteId}:${p.datahora}`;
    const jaImportado = ctx.ledger.resolver(LEDGER_FICHA, legada);
    if (jaImportado && !legadasUsadas.has(legada)) {
      legadasUsadas.add(legada);
      ctx.ledger.registrar(LEDGER_FICHA, chave, jaImportado);
    }
    nova({
      chave,
      pacienteOrigem: p.PacienteId,
      doctorId: profissionais.get(p.Usuario_ID ?? '') ?? ctx.ownerId,
      appointmentId: null,
      conteudo: {
        anamnesis: null,
        physicalExam: null,
        diagnosis: null,
        conduct: sanitizarHtmlClinico(
          `<h4>${escapar(tipo)} emitido no Feegow em ${dataBR(quando)}</h4>${p.conteudo}`,
        ),
      },
      criadaEm: quando,
      finalizadaEm: quando,
    });
  }

  if (paraODono) {
    rel.avisar(
      'ficha',
      '-',
      `${paraODono} fichas sem profissional importado no Feegow ficaram em nome do dono da conta`,
    );
  }
  return fichas;
}

export function planejarModelosVazios(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoModeloAnamnese[] {
  if (!ctx.opcoes.modelosVazios) return [];
  const vistos = new Set<string>();
  const novos: NovoModeloAnamnese[] = [];
  for (const f of exp.tabela('formularios')) {
    const nome = (f.Nome ?? '').trim().slice(0, 100);
    if (Number(f.id) <= 0 || f.sysActive !== '1' || !nome) continue;
    const chave = chaveDeNome(nome);
    const repetido = vistos.has(chave);
    vistos.add(chave);
    if (ctx.ledger.resolver(LEDGER_MODELO_ANAMNESE, f.id)) {
      ctx.relatorio.pular('modelo de anamnese');
      continue;
    }
    if (repetido) continue;
    const id = ctx.novoId();
    novos.push({ id, ownerId: ctx.ownerId, doctorId: ctx.ownerId, name: nome });
    ctx.ledger.registrar(LEDGER_MODELO_ANAMNESE, f.id!, id);
    ctx.relatorio.aceitar('modelo de anamnese');
  }
  return novos;
}

function lerFormularios(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): FormularioLido[] {
  const nomes = new Map(
    exp.tabela('formularios').map((f) => [f.id, (f.Nome ?? '').trim()]),
  );
  const preenchidos = exp.tabela('formularios_preenchidos');
  const conteudos = new Map<string, LinhaCsv>();
  for (const modelo of new Set(preenchidos.map((f) => f.modelo_id))) {
    for (const linha of exp.tabela(`_${modelo}`))
      conteudos.set(linha.id!, linha);
  }

  const lidos: FormularioLido[] = [];
  let rascunhosDeFora = 0;
  let semConteudo = 0;
  for (const f of preenchidos) {
    if (f.sys_active === '-1') continue;
    const linha = conteudos.get(f.id!);
    const conteudo = linha?.conteudo_resumo ?? '';
    if (htmlSemTexto(conteudo)) {
      if (f.sys_active === '1') semConteudo++;
      continue;
    }
    const rascunho = f.sys_active !== '1';
    if (rascunho && !ctx.opcoes.incluirRascunhos) {
      rascunhosDeFora++;
      continue;
    }
    const quando =
      dataHoraCompleta(linha?.data_hora) ?? dataHoraCompleta(f.sys_date);
    if (!quando) {
      ctx.relatorio.rejeitar('ficha', `form:${f.id}`, 'formulário sem data');
      continue;
    }
    lidos.push({
      id: f.id!,
      modeloId: f.modelo_id ?? '',
      nomeModelo: nomes.get(f.modelo_id) || 'Formulário',
      quando,
      conteudo,
      rascunho,
      pacienteId: f.paciente_id,
      atendimentoId:
        f.atendimento_id && f.atendimento_id !== '0' ? f.atendimento_id : null,
      profissionalId: linha?.profissionail_id ?? null,
    });
  }
  if (rascunhosDeFora) {
    ctx.relatorio.avisar(
      'ficha',
      '-',
      `${rascunhosDeFora} formulários em rascunho no Feegow com texto ficaram de fora (use --incluir-rascunhos para trazê-los)`,
    );
  }
  if (semConteudo) {
    ctx.relatorio.avisar(
      'ficha',
      '-',
      `${semConteudo} formulários ativos sem texto ignorados`,
    );
  }
  return lidos;
}

function chaveDoDocumentoEmitido(
  p: LinhaCsv,
  tipo: string,
  vistos: Map<string, number>,
): string {
  const base = `presc:${p.PacienteId}:${p.datahora}:${chaveDeNome(tipo)}`;
  const n = vistos.get(base) ?? 0;
  vistos.set(base, n + 1);
  return `${base}:${n}`;
}

function resumoComoFormulario(r: LinhaCsv, fallback: Date): FormularioFeegow {
  return {
    modeloId: MODELO_RESUMO_IA,
    nomeModelo: NOME_RESUMO_IA,
    quando: dataHoraCompleta(r.data) ?? fallback,
    conteudo: r.conteudo ?? '',
  };
}

function dataBR(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
