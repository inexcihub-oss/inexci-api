import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { Ledger } from '../core/ledger';
import { Relatorio } from '../core/report';
import { chaveDeNome, ContextoImportacao, UsuarioExistente } from './context';
import { ExportFeegow } from './export';
import { gravarCadastro, planejarCadastro } from './phases/cadastro.phase';
import { gravarAgenda, planejarAgenda } from './phases/agenda.phase';
import { gravarHistorico, planejarHistorico } from './phases/historico.phase';
import {
  gravarProntuario,
  planejarProntuario,
} from './phases/prontuario.phase';
import {
  descartadosDosAnexos,
  enviarAnexos,
  gravarAnexos,
  planejarAnexosDaFase,
} from './phases/anexos.phase';
import { gravarModelos, planejarModelos } from './phases/modelos.phase';
import {
  gravarDisponibilidade,
  planejarDisponibilidade,
} from './phases/disponibilidade.phase';
import { ArmazenamentoImportacao } from '../core/armazenamento';

/** Fases do importador, na ordem em que precisam rodar. */
export interface Fase<P = unknown> {
  nome: string;
  planejar(exp: ExportFeegow, ctx: ContextoImportacao): P;
  gravar(plano: P, manager: EntityManager): Promise<void>;
  /**
   * Passo fora do banco antes da transação (upload de arquivos). Devolve o
   * que criou, para o runner desfazer se a gravação falhar.
   */
  enviar?(plano: P, armazenamento: ArmazenamentoImportacao): Promise<string[]>;
  /**
   * Arquivos enviados que a gravação acabou não usando (ex.: paciente que já
   * tinha foto). O runner apaga depois do COMMIT.
   */
  descartados?(plano: P): string[];
}

export const FASES: Fase<any>[] = [
  { nome: 'cadastro', planejar: planejarCadastro, gravar: gravarCadastro },
  { nome: 'agenda', planejar: planejarAgenda, gravar: gravarAgenda },
  {
    nome: 'historico',
    planejar: planejarHistorico,
    gravar: gravarHistorico,
  },
  {
    nome: 'prontuario',
    planejar: planejarProntuario,
    gravar: gravarProntuario,
  },
  {
    nome: 'anexos',
    planejar: planejarAnexosDaFase,
    enviar: enviarAnexos,
    gravar: gravarAnexos,
    descartados: descartadosDosAnexos,
  },
  { nome: 'modelos', planejar: planejarModelos, gravar: gravarModelos },
  {
    nome: 'disponibilidade',
    planejar: planejarDisponibilidade,
    gravar: gravarDisponibilidade,
  },
];

export interface OpcoesCli {
  dir: string;
  ownerEmail: string | null;
  fase: string;
  dryRun: boolean;
  semBanco: boolean;
  out: string;
  mapear: Map<string, string>;
  somenteComAtividade: boolean;
  lembretes: boolean;
  passadasSemAtendimento: 'manter' | 'completed' | 'no_show';
  caixaLivre: 'anamnesis' | 'conduct';
  incluirRascunhos: boolean;
  modelosVazios: boolean;
  bloqueiosSoFuturos: boolean;
  /** Só confere a carga já feita (ledger × banco); não roda fase. */
  verificar: boolean;
  hoje: string;
  confirmar: boolean;
  /**
   * Aceita um `ledger.json` do formato antigo (sem conta/banco gravados) como
   * desta conta e deste banco. Ver `Ledger.vincular`.
   */
  adotarLedger: boolean;
}

const USO = `Uso:
  yarn import:feegow --dir <pasta do export> --owner-email <e-mail do dono> \\
    --fase ${FASES.map((f) => f.nome).join('|')}|tudo [--dry-run] [--sem-banco] [--out <pasta>] \\
    [--mapear prof:8=email@x.com] [--mapear func:2=email@x.com] \\
    [--somente-com-atividade] [--lembretes] [--passadas-sem-atendimento completed|no_show] \\
    [--caixa-livre anamnesis|conduct] [--incluir-rascunhos] [--modelos-vazios] \\
    [--bloqueios-so-futuros] \\
  yarn import:feegow --dir <pasta> --owner-email <e-mail> --verificar [--out <pasta>]
    [--hoje AAAA-MM-DD] [--sim] [--adotar-ledger]

  --dry-run      planeja e grava só o relatório (nada no banco, ledger intacto)
  --sem-banco    dry-run sem conexão (não confere e-mails/telefones já usados)
  --sim          não pede confirmação antes de gravar (use só em ambiente local)
  --hoje         data de corte passadas/futuras (padrão: hoje em São Paulo)
  --adotar-ledger  aceita um ledger.json antigo, sem conta/banco gravados, como
                 desta conta e deste banco (confira antes: ledger de outra
                 conta faz a carga apontar para pacientes alheios)
  --lembretes    deixa a INEXCI enviar lembrete das consultas futuras importadas
  --passadas-sem-atendimento  reclassifica consultas passadas que ficaram em
                 aberto sem atendimento (padrão: manter como no Feegow)
  --caixa-livre  campo da ficha que recebe os formulários de texto livre
                 (padrão: anamnesis)
  --incluir-rascunhos  formulários em rascunho no Feegow com texto entram na
                 ficha, marcados como rascunho
  --modelos-vazios  cria um modelo de anamnese vazio por formulário do Feegow
  --bloqueios-so-futuros  importa só os bloqueios de agenda de hoje em diante
  --verificar    pós-carga: confere no banco cada registro do ledger.json`;

export function interpretarArgumentos(argv: string[]): OpcoesCli {
  const valor = (nome: string) => {
    const i = argv.indexOf(nome);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const tem = (nome: string) => argv.includes(nome);

  const dir = valor('--dir');
  const verificar = tem('--verificar');
  const fase = valor('--fase') ?? (verificar ? 'tudo' : null);
  if (!dir || !fase)
    throw new Error(`--dir e --fase são obrigatórios.\n\n${USO}`);
  if (verificar && tem('--sem-banco')) {
    throw new Error(
      '--verificar consulta o banco: não combina com --sem-banco.',
    );
  }
  if (fase !== 'tudo' && !FASES.some((f) => f.nome === fase)) {
    throw new Error(`Fase desconhecida: ${fase}.\n\n${USO}`);
  }

  const semBanco = tem('--sem-banco');
  const dryRun = tem('--dry-run') || semBanco;
  const ownerEmail = valor('--owner-email')?.toLowerCase() ?? null;
  if (!semBanco && !ownerEmail) {
    throw new Error(`--owner-email é obrigatório com banco.\n\n${USO}`);
  }

  const mapear = new Map<string, string>();
  argv.forEach((arg, i) => {
    if (arg !== '--mapear') return;
    const m = /^(prof|func):(\S+)=(\S+@\S+)$/.exec(argv[i + 1] ?? '');
    if (!m)
      throw new Error(`--mapear inválido: ${argv[i + 1]} (use prof:8=email)`);
    mapear.set(`${m[1]}:${m[2]}`, m[3].toLowerCase());
  });

  const passadas = valor('--passadas-sem-atendimento') ?? 'manter';
  if (!['manter', 'completed', 'no_show'].includes(passadas)) {
    throw new Error(
      `--passadas-sem-atendimento inválido: ${passadas} (use completed ou no_show)`,
    );
  }

  const caixaLivre = valor('--caixa-livre') ?? 'anamnesis';
  if (!['anamnesis', 'conduct'].includes(caixaLivre)) {
    throw new Error(
      `--caixa-livre inválido: ${caixaLivre} (use anamnesis ou conduct)`,
    );
  }

  const hoje = valor('--hoje') ?? hojeEmSaoPaulo();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje))
    throw new Error('--hoje deve ser AAAA-MM-DD');

  return {
    dir,
    ownerEmail,
    fase,
    dryRun,
    semBanco,
    out: valor('--out') ?? dir,
    mapear,
    somenteComAtividade: tem('--somente-com-atividade'),
    lembretes: tem('--lembretes'),
    passadasSemAtendimento: passadas as OpcoesCli['passadasSemAtendimento'],
    caixaLivre: caixaLivre as OpcoesCli['caixaLivre'],
    incluirRascunhos: tem('--incluir-rascunhos'),
    modelosVazios: tem('--modelos-vazios'),
    bloqueiosSoFuturos: tem('--bloqueios-so-futuros'),
    verificar,
    hoje,
    confirmar: !tem('--sim'),
    adotarLedger: tem('--adotar-ledger'),
  };
}

/**
 * Data de hoje (`YYYY-MM-DD`) no fuso da clínica. `toISOString()` daria a data
 * UTC: entre 21h e meia-noite em São Paulo já é "amanhã", e as consultas da
 * noite seriam classificadas como passadas.
 */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/**
 * Nunca contra o banco dos e2e (que trunca tudo a cada teste) nem com
 * NODE_ENV=test: o importador grava dado de paciente real.
 */
export function assertBancoPermitido(
  nomeDoBanco: string,
  nodeEnv: string | undefined,
): void {
  if (nodeEnv === 'test') {
    throw new Error('Importador não roda com NODE_ENV=test.');
  }
  const bancoDeTeste = process.env.TEST_DB_NAME || 'inexci_test';
  if (nomeDoBanco === bancoDeTeste) {
    throw new Error(
      `Importador não roda contra o banco de teste (${nomeDoBanco}).`,
    );
  }
}

/** Monta o contexto lendo do banco o que a fase precisa conferir. */
export async function contextoDoBanco(
  ds: DataSource,
  ownerEmail: string,
  base: Omit<
    ContextoImportacao,
    | 'ownerId'
    | 'usuariosPorEmail'
    | 'telefonesEmUso'
    | 'conveniosExistentes'
    | 'consultasComFicha'
  >,
): Promise<ContextoImportacao> {
  const [dono] = await ds.query(
    `SELECT id, owner_id FROM users
      WHERE lower(email) = $1 AND deleted_at IS NULL`,
    [ownerEmail],
  );
  if (!dono) throw new Error(`Dono não encontrado: ${ownerEmail}`);
  if (dono.id !== dono.owner_id) {
    throw new Error(`${ownerEmail} não é o dono da conta (owner_id ≠ id).`);
  }

  const usuarios: {
    id: string;
    email: string;
    owner_id: string;
    tem_perfil: boolean;
    excluido: boolean;
  }[] = await ds.query(
    // Excluídos também vêm (marcados): o e-mail deles pode ainda ocupar
    // `uq_users_email`, e a equipe precisa saber para não casar nem recriar.
    `SELECT u.id, lower(u.email) AS email, u.owner_id,
              (dp.id IS NOT NULL) AS tem_perfil,
              (u.deleted_at IS NOT NULL) AS excluido
         FROM users u
         LEFT JOIN doctor_profiles dp ON dp.user_id = u.id`,
  );
  const telefones: { phone: string }[] = await ds.query(
    `SELECT phone FROM users WHERE phone IS NOT NULL AND deleted_at IS NULL`,
  );
  const convenios: { id: string; name: string }[] = await ds.query(
    `SELECT id, name FROM health_plans WHERE owner_id = $1 AND deleted_at IS NULL`,
    [dono.id],
  );
  const fichas: { appointment_id: string }[] = await ds.query(
    `SELECT appointment_id FROM clinical_records
      WHERE owner_id = $1 AND appointment_id IS NOT NULL AND deleted_at IS NULL`,
    [dono.id],
  );

  return {
    ...base,
    ownerId: dono.id,
    usuariosPorEmail: new Map(
      usuarios.map((u): [string, UsuarioExistente] => [
        u.email,
        {
          id: u.id,
          email: u.email,
          ownerId: u.owner_id,
          temPerfil: u.tem_perfil,
          excluido: u.excluido,
        },
      ]),
    ),
    telefonesEmUso: new Set(telefones.map((t) => t.phone)),
    conveniosExistentes: new Map(
      convenios.map((c) => [chaveDeNome(c.name), c.id]),
    ),
    consultasComFicha: new Set(fichas.map((f) => f.appointment_id)),
  };
}

/** Dry-run sem conexão: nada existente para conferir, dono fictício. */
export function contextoSemBanco(
  base: Omit<
    ContextoImportacao,
    | 'ownerId'
    | 'usuariosPorEmail'
    | 'telefonesEmUso'
    | 'conveniosExistentes'
    | 'consultasComFicha'
  >,
): ContextoImportacao {
  return {
    ...base,
    ownerId: '00000000-0000-0000-0000-000000000000',
    usuariosPorEmail: new Map(),
    telefonesEmUso: new Set(),
    conveniosExistentes: new Map(),
    consultasComFicha: new Set(),
  };
}

export function baseDoContexto(
  opcoes: OpcoesCli,
  ledger: Ledger,
  relatorio: Relatorio,
) {
  return {
    hoje: opcoes.hoje,
    ledger,
    relatorio,
    novoId: randomUUID,
    mapear: opcoes.mapear,
    opcoes: {
      somenteComAtividade: opcoes.somenteComAtividade,
      lembretes: opcoes.lembretes,
      passadasSemAtendimento: opcoes.passadasSemAtendimento,
      caixaLivre: opcoes.caixaLivre,
      incluirRascunhos: opcoes.incluirRascunhos,
      modelosVazios: opcoes.modelosVazios,
      bloqueiosSoFuturos: opcoes.bloqueiosSoFuturos,
    },
  };
}

export function salvarRelatorio(out: string, relatorio: Relatorio): string {
  mkdirSync(out, { recursive: true });
  const caminho = join(out, `relatorio-${relatorio.fase}.json`);
  writeFileSync(caminho, JSON.stringify(relatorio.paraJson(), null, 2));
  return caminho;
}
