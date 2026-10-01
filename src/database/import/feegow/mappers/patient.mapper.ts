import { LinhaCsv } from '../../core/csv';
import {
  dataHoraCompleta,
  normalizarCep,
  normalizarCpf,
  normalizarData,
  normalizarEmail,
  normalizarSexo,
  normalizarTexto,
  normalizarUf,
  telefonesDistintos,
} from '../../core/normalizers';
import { chaveDeNome, ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { profissionaisPorPaciente } from '../rules/primary-doctor.rule';
import { LEDGER_PROFISSIONAL } from './team.mapper';
import {
  CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA,
  LEDGER_CONVENIO,
} from './health-plan.mapper';

export const LEDGER_PACIENTE = 'patient';

export interface NovoPaciente {
  id: string;
  ownerId: string;
  doctorId: string;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  gender: string | null;
  birthDate: string | null;
  healthPlanId: string | null;
  healthPlanNumber: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  medicalNotes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Lookups do Feegow com valor real para meia dúzia de pacientes. */
const TABELAS_DEMOGRAFICAS: [
  campo: string,
  tabela: string,
  coluna: string,
  rotulo: string,
][] = [
  ['estado_civil_id', 'estadocivil', 'estadocivil', 'Estado civil'],
  ['escolaridade', 'escolaridade', 'escolaridade', 'Escolaridade'],
  ['origem_id', 'origens', 'nome_origem', 'Como conheceu'],
  ['prioridade_id', 'pacientes_prioridades', 'prioridade', 'Prioridade'],
];

/**
 * Pacientes: `pacientes` + `paciente_endereco` + `paciente_convenio` (1:1).
 *
 * - `sys_active` 1 → ativo, 0 → inativo, -1 (excluído) → fora.
 * - CPF inválido é descartado (fica `null`) com aviso — a SC cobra depois.
 * - Telefone: celular > celular_2 > fixo_1 > fixo_2; o segundo válido vai
 *   para `secondary_phone`, os demais para as observações.
 * - Médico responsável: `primary-doctor.rule`, pulando profissional que não
 *   foi importado; sem nenhum → o dono da conta.
 * - Convênio: o da consulta ativa mais recente com convênio de verdade.
 * - Dados demográficos que a INEXCI não tem (estado civil, profissão…) vão
 *   para as observações, quando preenchidos.
 */
export function planejarPacientes(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovoPaciente[] {
  const rel = ctx.relatorio;
  const enderecoPorPaciente = indexar(
    exp.tabela('paciente_endereco'),
    'paciente_id',
  );
  const convenioPorPaciente = indexar(
    exp.tabela('paciente_convenio'),
    'paciente_id',
  );
  const profissionais = profissionaisPorPaciente(exp.tabela('agendamentos'));
  const convenioDaConsulta = convenioMaisRecente(exp.tabela('agendamentos'));
  const comAtividade = ctx.opcoes.somenteComAtividade
    ? pacientesComAtividade(exp)
    : null;
  const lookups = TABELAS_DEMOGRAFICAS.map(
    ([campo, tabela, coluna, rotulo]) =>
      [
        campo,
        rotulo,
        new Map(exp.tabela(tabela).map((l) => [l.id, l[coluna]])),
      ] as const,
  );

  const novos: NovoPaciente[] = [];
  const cpfsVistos = new Map<string, string>();
  const nomesVistos = new Map<string, string>();

  for (const p of exp.tabela('pacientes')) {
    const idOrigem = p.id!;
    if (ctx.ledger.resolver(LEDGER_PACIENTE, idOrigem)) {
      rel.pular('paciente');
      continue;
    }
    if (p.sys_active === '-1') {
      rel.rejeitar('paciente', idOrigem, 'excluído no Feegow');
      continue;
    }
    if (comAtividade && !comAtividade.has(idOrigem)) {
      rel.rejeitar(
        'paciente',
        idOrigem,
        'sem consulta, atendimento nem ficha (--somente-com-atividade)',
      );
      continue;
    }
    const nome = normalizarTexto(p.nome_paciente, 100);
    if (!nome) {
      rel.rejeitar('paciente', idOrigem, 'sem nome');
      continue;
    }

    const cpf = normalizarCpf(p.cpf);
    if (p.cpf && !cpf)
      rel.avisar('paciente', idOrigem, 'CPF inválido descartado');
    if (cpf) {
      const outro = cpfsVistos.get(cpf);
      if (outro)
        rel.avisar(
          'paciente',
          idOrigem,
          'CPF repetido em outro paciente',
          `paciente ${outro}`,
        );
      else cpfsVistos.set(cpf, idOrigem);
    }
    const chaveNome = chaveDeNome(nome);
    const homonimo = nomesVistos.get(chaveNome);
    if (homonimo)
      rel.avisar(
        'paciente',
        idOrigem,
        'nome repetido em outro paciente',
        `paciente ${homonimo}`,
      );
    else nomesVistos.set(chaveNome, idOrigem);

    const telefones = telefonesDistintos([
      p.celular,
      p.celular_2,
      p.fixo_1,
      p.fixo_2,
    ]);
    if (telefones.length === 0)
      rel.avisar('paciente', idOrigem, 'sem telefone');

    const end = enderecoPorPaciente.get(idOrigem);
    const conv = convenioPorPaciente.get(idOrigem);

    const notas: string[] = [];
    const obs = (p.Observacoes ?? '').trim();
    if (obs) notas.push(obs);
    if (telefones.length > 2)
      notas.push(`Outros telefones: ${telefones.slice(2).join(', ')}`);
    for (const [campo, rotulo, mapa] of lookups) {
      const valor = mapa.get(p[campo] ?? '');
      if (p[campo] && p[campo] !== '0' && valor)
        notas.push(`${rotulo}: ${valor}`);
    }
    for (const [campo, rotulo] of [
      ['profissao', 'Profissão'],
      ['naturalidade', 'Naturalidade'],
      ['indicacao', 'Indicação'],
      ['Peso', 'Peso'],
      ['Altura', 'Altura'],
    ] as const) {
      const valor = (p[campo] ?? '').trim();
      if (valor) notas.push(`${rotulo}: ${valor}`);
    }

    const doctorId =
      (profissionais.get(idOrigem) ?? [])
        .map((prof) => ctx.ledger.resolver(LEDGER_PROFISSIONAL, prof))
        .find((uuid): uuid is string => !!uuid) ?? ctx.ownerId;

    const convenioOrigem =
      convenioDaConsulta.get(idOrigem) ?? primeiroConvenio(conv);
    const healthPlanId = ctx.ledger.resolver(LEDGER_CONVENIO, convenioOrigem);

    const criadoEm =
      dataHoraCompleta(p.sys_date) ?? dataHoraCompleta(p.dhup) ?? new Date();
    const id = ctx.novoId();
    novos.push({
      id,
      ownerId: ctx.ownerId,
      doctorId,
      name: nome,
      cpf,
      email: normalizarEmail(p.email),
      phone: telefones[0] ?? null,
      secondaryPhone: telefones[1] ?? null,
      gender: normalizarSexo(p.sexo),
      birthDate: normalizarData(p.nascimento),
      healthPlanId,
      healthPlanNumber: healthPlanId
        ? normalizarTexto(conv?.matricula1, 50)
        : null,
      zipCode: normalizarCep(end?.cep),
      address: normalizarTexto(end?.logradouro, 200),
      addressNumber: normalizarTexto(end?.numero, 20),
      addressComplement: normalizarTexto(end?.complemento, 100),
      neighborhood: normalizarTexto(end?.bairro, 100),
      city: normalizarTexto(end?.cidade, 100),
      state: normalizarUf(end?.estado),
      medicalNotes: notas.length ? notas.join('\n') : null,
      active: p.sys_active === '1',
      createdAt: criadoEm,
      updatedAt: criadoEm,
    });
    ctx.ledger.registrar(LEDGER_PACIENTE, idOrigem, id);
    rel.aceitar('paciente');
  }

  return novos;
}

function indexar(linhas: LinhaCsv[], chave: string): Map<string, LinhaCsv> {
  return new Map(linhas.filter((l) => l[chave]).map((l) => [l[chave]!, l]));
}

/** Convênio da consulta ativa mais recente que tem convênio de verdade. */
function convenioMaisRecente(agendamentos: LinhaCsv[]): Map<string, string> {
  const melhor = new Map<string, { quando: string; convenio: string }>();
  for (const a of agendamentos) {
    const conv = a.convenio_id;
    if (a.sys_active !== '1' || !a.paciente_id || !conv || conv === '0')
      continue;
    if (CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA.has(conv)) continue;
    const quando = `${a.Data ?? ''} ${a.Hora ?? ''}`;
    const atual = melhor.get(a.paciente_id);
    if (!atual || quando > atual.quando)
      melhor.set(a.paciente_id, { quando, convenio: conv });
  }
  return new Map([...melhor].map(([p, v]) => [p, v.convenio]));
}

function primeiroConvenio(conv: LinhaCsv | undefined): string | null {
  for (const k of ['convenio_id1', 'convenio_id2', 'convenio_id3']) {
    const v = conv?.[k];
    if (v && v !== '0' && !CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA.has(v)) return v;
  }
  return null;
}

function pacientesComAtividade(exp: ExportFeegow): Set<string> {
  const ids = new Set<string>();
  for (const a of exp.tabela('agendamentos')) {
    if (a.sys_active === '1' && a.paciente_id) ids.add(a.paciente_id);
  }
  for (const a of exp.tabela('atendimentos'))
    if (a.paciente_id) ids.add(a.paciente_id);
  for (const f of exp.tabela('formularios_preenchidos')) {
    if (f.sys_active === '1' && f.paciente_id) ids.add(f.paciente_id);
  }
  return ids;
}
