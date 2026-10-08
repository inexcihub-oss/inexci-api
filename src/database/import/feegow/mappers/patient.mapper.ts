import { LinhaCsv } from '../../core/csv';
import {
  dataHoraCompleta,
  normalizarCep,
  normalizarCpf,
  normalizarData,
  EMAIL_MAX,
  emailLongoDemais,
  normalizarEmail,
  normalizarSexo,
  normalizarTelefone,
  normalizarTexto,
  normalizarUf,
  repararNomeCortado,
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
 * - `sys_active` 1 → ativo, 0 → inativo, -1 (excluído) → fora, salvo se
 *   tiver consulta, atendimento, formulário ou anexo: aí entra inativo.
 * - CPF inválido fica `null` (a SC cobra depois) e o valor original vai para
 *   as observações, como todo contato sem formato válido (`contatosDoPaciente`).
 * - Telefone: celular > celular_2 > fixo_1 > fixo_2; o segundo válido vai
 *   para `secondary_phone`, os demais para as observações.
 * - Médico responsável: `primary-doctor.rule`, pulando profissional que não
 *   foi importado; sem nenhum → o dono da conta.
 * - Convênio: o da consulta ativa mais recente com convênio de verdade.
 * - Dados demográficos que a INEXCI não tem (estado civil, profissão…) vão
 *   para as observações, quando preenchidos.
 * - CPF repetido só avisa: o mesmo CPF pode ser de pessoas diferentes
 *   (filho com o CPF da mãe, digitação), então nada é mesclado sozinho.
 * - Nome sem nenhuma letra (é um telefone), sem nenhum outro dado e sem
 *   consulta, atendimento ou ficha: fora. Com qualquer um deles, entra com aviso.
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
  const atividade = pacientesComAtividade(exp);
  const comAtividade = ctx.opcoes.somenteComAtividade ? atividade : null;
  const comAnexo = pacientesComAnexo(exp);
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
    // Excluído no Feegow: em geral um cadastro duplicado, mas o Feegow não
    // move consulta nem formulário para o cadastro que ficou. Com qualquer um
    // deles (ou anexo), entra inativo — descartar levaria o prontuário junto.
    const excluidoComRegistro =
      p.sys_active === '-1' &&
      (atividade.has(idOrigem) || comAnexo.has(idOrigem));
    if (p.sys_active === '-1' && !excluidoComRegistro) {
      rel.rejeitar('paciente', idOrigem, 'excluído no Feegow');
      continue;
    }
    if (excluidoComRegistro) {
      rel.avisar(
        'paciente',
        idOrigem,
        'excluído no Feegow, mas com consulta, prontuário ou anexo: entra inativo para não perder o registro',
      );
    }
    if (comAtividade && !comAtividade.has(idOrigem)) {
      rel.rejeitar(
        'paciente',
        idOrigem,
        'sem consulta, atendimento nem ficha (--somente-com-atividade)',
      );
      continue;
    }
    const nomeBruto = normalizarTexto(p.nome_paciente, 100);
    if (!nomeBruto) {
      rel.rejeitar('paciente', idOrigem, 'sem nome');
      continue;
    }
    // O export do Feegow cortou alguns nomes numa entidade HTML (`JOS&EACUTE`)
    // e, nessas linhas, às vezes deslocou as colunas seguintes.
    const { nome, cortado } = repararNomeCortado(nomeBruto);
    // Nome sem letras ("24 98841-4691", "."): sem nenhum outro dado, anexo
    // nem atividade, não há paciente aqui — é lixo de cadastro. Vem antes de
    // qualquer aviso ou registro de CPF/nome, para o descarte não deixar rastro.
    if (!/\p{L}/u.test(nome)) {
      if (
        !temOutroDado(
          p,
          enderecoPorPaciente.get(idOrigem),
          convenioPorPaciente.get(idOrigem),
        ) &&
        !atividade.has(idOrigem) &&
        !comAnexo.has(idOrigem) &&
        !p.foto
      ) {
        rel.rejeitar(
          'paciente',
          idOrigem,
          'nome sem letras e nenhum outro dado',
        );
        continue;
      }
      rel.avisar(
        'paciente',
        idOrigem,
        'nome sem letras: revise o nome no cadastro',
      );
    }
    if (cortado) {
      rel.avisar(
        'paciente',
        idOrigem,
        'nome incompleto no export do Feegow: revise o nome no cadastro',
        nome,
      );
    }
    const contatos = contatosDoPaciente(p);
    if (contatos.emailLongo) {
      rel.avisar(
        'paciente',
        idOrigem,
        `e-mail com mais de ${EMAIL_MAX.paciente} caracteres descartado: fica só nas observações`,
      );
    }
    if (contatos.deslocados.length) {
      rel.avisar(
        'paciente',
        idOrigem,
        'colunas deslocadas no export do Feegow: dados recuperados de outra coluna, revise o cadastro',
        contatos.deslocados.join(', '),
      );
    }

    const cpf = contatos.cpf;
    if (contatos.cpfInvalido)
      rel.avisar('paciente', idOrigem, 'CPF inválido: fica só nas observações');
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

    const telefones = contatos.telefones;
    if (telefones.length === 0)
      rel.avisar('paciente', idOrigem, 'sem telefone');

    const end = enderecoPorPaciente.get(idOrigem);
    const conv = convenioPorPaciente.get(idOrigem);

    const notas: string[] = [];
    const obs = (p.Observacoes ?? '').trim();
    if (obs) notas.push(obs);
    if (excluidoComRegistro)
      notas.push(
        'Cadastro excluído no Feegow (provável duplicado); mantido inativo por ter consulta, prontuário ou anexo.',
      );
    notas.push(...contatos.naoReconhecidos);
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
      email: contatos.email,
      phone: telefones[0] ?? null,
      secondaryPhone: telefones[1] ?? null,
      gender: normalizarSexo(p.sexo),
      birthDate: contatos.nascimento,
      healthPlanId,
      healthPlanNumber: healthPlanId
        ? matriculaDoConvenio(
            conv,
            convenioOrigem,
            (id) => ctx.ledger.resolver(LEDGER_CONVENIO, id) === healthPlanId,
          )
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

const COLUNAS_DE_TELEFONE = ['celular', 'celular_2', 'fixo_1', 'fixo_2'];
const PARECE_DATA = /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/;

interface ContatosDoPaciente {
  cpf: string | null;
  cpfInvalido: boolean;
  email: string | null;
  /** Havia e-mail válido, mas maior que `patients.email` (fica nas observações). */
  emailLongo: boolean;
  nascimento: string | null;
  telefones: string[];
  /** O que foi recuperado de outra coluna (`e-mail`, `nascimento`, `telefone`). */
  deslocados: string[];
  /** Valores sem formato válido: vão para as observações, não se perdem. */
  naoReconhecidos: string[];
}

/**
 * CPF, telefones, e-mail e nascimento de uma linha de `pacientes`.
 *
 * Em algumas linhas o export do Feegow deslocou as colunas (o nome cortado
 * numa entidade HTML empurra o resto): o telefone cai no CPF, o e-mail num
 * telefone, o nascimento no e-mail. Cada valor é reconhecido pelo formato e
 * vai para o campo certo quando o próprio está vazio. Valor que não se
 * reconhece (CPF com dígito errado, telefone incompleto, data impossível) fica
 * nas observações — descartá-lo apagaria o único registro dele.
 */
export function contatosDoPaciente(p: LinhaCsv): ContatosDoPaciente {
  const r: ContatosDoPaciente = {
    cpf: null,
    cpfInvalido: false,
    email: null,
    emailLongo: false,
    nascimento: null,
    telefones: [],
    deslocados: [],
    naoReconhecidos: [],
  };
  const emailsDeslocados: string[] = [];
  const datasDeslocadas: string[] = [];
  const telefonesDeslocados: string[] = [];
  const valor = (coluna: string) => {
    const v = (p[coluna] ?? '').trim();
    return temConteudo(v) ? v : null;
  };
  const deslocado = (v: string): boolean => {
    if (normalizarEmail(v)) emailsDeslocados.push(v);
    else if (PARECE_DATA.test(v)) datasDeslocadas.push(v);
    else if (/\(/.test(v) && normalizarTelefone(v)) telefonesDeslocados.push(v);
    else return false;
    return true;
  };

  const cpf = valor('cpf');
  if (cpf) {
    r.cpf = normalizarCpf(cpf);
    if (!r.cpf && !deslocado(cpf)) {
      r.cpfInvalido = true;
      r.naoReconhecidos.push(`CPF no Feegow (inválido): ${cpf}`);
    }
  }
  const telefones: string[] = [];
  for (const coluna of COLUNAS_DE_TELEFONE) {
    const v = valor(coluna);
    if (!v) continue;
    if (normalizarTelefone(v)) telefones.push(v);
    else if (!deslocado(v))
      r.naoReconhecidos.push(`Telefone no Feegow (incompleto): ${v}`);
  }
  const email = valor('email');
  if (email) {
    r.email = normalizarEmail(email, EMAIL_MAX.paciente);
    if (!r.email && emailLongoDemais(email, EMAIL_MAX.paciente)) {
      r.emailLongo = true;
      r.naoReconhecidos.push(
        `E-mail no Feegow (mais de ${EMAIL_MAX.paciente} caracteres): ${email}`,
      );
    } else if (!r.email && !deslocado(email))
      r.naoReconhecidos.push(`E-mail no Feegow (inválido): ${email}`);
  }
  const nascimento = valor('nascimento');
  if (nascimento) {
    r.nascimento = normalizarData(nascimento);
    if (!r.nascimento)
      r.naoReconhecidos.push(`Nascimento no Feegow (inválido): ${nascimento}`);
  }

  if (!r.email && emailsDeslocados.length) {
    // O 1º que cabe na coluna; o longo demais fica nas observações.
    const i = emailsDeslocados.findIndex((e) =>
      normalizarEmail(e, EMAIL_MAX.paciente),
    );
    if (i >= 0) {
      r.email = normalizarEmail(
        emailsDeslocados.splice(i, 1)[0],
        EMAIL_MAX.paciente,
      );
      r.deslocados.push('e-mail');
    } else r.emailLongo = true;
  }
  for (const e of emailsDeslocados)
    r.naoReconhecidos.push(`Outro e-mail no Feegow: ${e}`);
  for (const d of datasDeslocadas) {
    const data = normalizarData(d);
    if (!r.nascimento && data) {
      r.nascimento = data;
      r.deslocados.push('nascimento');
    } else r.naoReconhecidos.push(`Data fora do lugar no Feegow: ${d}`);
  }
  if (telefonesDeslocados.length) r.deslocados.push('telefone');
  r.telefones = telefonesDistintos([...telefones, ...telefonesDeslocados]);
  return r;
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

/**
 * Número da carteirinha do convênio escolhido: `matriculaN` do mesmo slot
 * `convenio_idN`. Vale o id igual; senão, um slot cujo convênio virou o mesmo
 * na INEXCI (`mesmoConvenio` — "UNIMED" e "unimed" fundidos). Convênio que
 * não está no cadastro do paciente (veio só da consulta) não tem matrícula
 * correspondente → `null`, nunca a de outro convênio.
 */
export function matriculaDoConvenio(
  conv: LinhaCsv | undefined,
  convenioId: string | null,
  mesmoConvenio: (convenioIdDoSlot: string) => boolean = () => false,
): string | null {
  if (!conv || !convenioId) return null;
  const slots = ['1', '2', '3'].filter((n) => {
    const id = conv[`convenio_id${n}`];
    return !!id && id !== '0';
  });
  const slot =
    slots.find((n) => conv[`convenio_id${n}`] === convenioId) ??
    slots.find((n) => mesmoConvenio(conv[`convenio_id${n}`]!));
  return slot ? normalizarTexto(conv[`matricula${slot}`], 50) : null;
}

function primeiroConvenio(conv: LinhaCsv | undefined): string | null {
  for (const k of ['convenio_id1', 'convenio_id2', 'convenio_id3']) {
    const v = conv?.[k];
    if (v && v !== '0' && !CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA.has(v)) return v;
  }
  return null;
}

/** Pacientes com anexo ativo — o que se perderia junto (mesmo critério de `planejarAnexos`). */
function pacientesComAnexo(exp: ExportFeegow): Set<string> {
  const ids = new Set<string>();
  for (const a of exp.tabela('arquivos')) {
    if (a.sysActive === '1' && a.PacienteID && a.PacienteID !== '0')
      ids.add(a.PacienteID);
  }
  return ids;
}

/** Colunas de texto de `pacientes` que vão para as notas do paciente. */
const COLUNAS_DE_TEXTO = [
  'Observacoes',
  'profissao',
  'naturalidade',
  'indicacao',
  'Peso',
  'Altura',
];
const COLUNAS_DO_ENDERECO = [
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
];

/**
 * Valor que diz algo: tem letra ou dígito diferente de zero. Descarta os
 * preenchimentos vazios do Feegow — `0`, `0.00`, `0000-00-00`, máscara de
 * telefone sem número (`(  )     -    `).
 */
const temConteudo = (v: string | null | undefined) =>
  /[\p{L}1-9]/u.test(v ?? '');

/**
 * Algum dado que a importação levaria para a INEXCI além do nome: cadastro,
 * notas, endereço ou convênio. Até um CPF inválido conta — mostra que o
 * registro é de alguém.
 */
function temOutroDado(
  p: LinhaCsv,
  end: LinhaCsv | undefined,
  conv: LinhaCsv | undefined,
): boolean {
  return (
    temConteudo(p.cpf) ||
    !!normalizarData(p.nascimento) ||
    !!normalizarEmail(p.email) ||
    telefonesDistintos([p.celular, p.celular_2, p.fixo_1, p.fixo_2]).length >
      0 ||
    COLUNAS_DE_TEXTO.some((c) => temConteudo(p[c])) ||
    TABELAS_DEMOGRAFICAS.some(([campo]) => temConteudo(p[campo])) ||
    !!normalizarCep(end?.cep) ||
    !!normalizarUf(end?.estado) ||
    COLUNAS_DO_ENDERECO.some((c) => temConteudo(end?.[c])) ||
    !!primeiroConvenio(conv) ||
    temConteudo(conv?.matricula1)
  );
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
