import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { Ledger } from '../core/ledger';
import { Relatorio } from '../core/report';
import { chaveDeNome, ContextoImportacao, UsuarioExistente } from './context';
import { ExportFeegow } from './export';
import { gravarCadastro, planejarCadastro } from './phases/cadastro.phase';

/** Fases do importador, na ordem em que precisam rodar. */
export interface Fase<P = unknown> {
  nome: string;
  planejar(exp: ExportFeegow, ctx: ContextoImportacao): P;
  gravar(plano: P, manager: EntityManager): Promise<void>;
}

export const FASES: Fase<any>[] = [
  { nome: 'cadastro', planejar: planejarCadastro, gravar: gravarCadastro },
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
  hoje: string;
  confirmar: boolean;
}

const USO = `Uso:
  yarn import:feegow --dir <pasta do export> --owner-email <e-mail do dono> \\
    --fase ${FASES.map((f) => f.nome).join('|')}|tudo [--dry-run] [--sem-banco] [--out <pasta>] \\
    [--mapear prof:8=email@x.com] [--mapear func:2=email@x.com] \\
    [--somente-com-atividade] [--hoje AAAA-MM-DD] [--sim]

  --dry-run      planeja e grava só o relatório (nada no banco, ledger intacto)
  --sem-banco    dry-run sem conexão (não confere e-mails/telefones já usados)
  --sim          não pede confirmação antes de gravar (use só em ambiente local)`;

export function interpretarArgumentos(argv: string[]): OpcoesCli {
  const valor = (nome: string) => {
    const i = argv.indexOf(nome);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const tem = (nome: string) => argv.includes(nome);

  const dir = valor('--dir');
  const fase = valor('--fase');
  if (!dir || !fase)
    throw new Error(`--dir e --fase são obrigatórios.\n\n${USO}`);
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

  const hoje = valor('--hoje') ?? new Date().toISOString().slice(0, 10);
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
    hoje,
    confirmar: !tem('--sim'),
  };
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
    'ownerId' | 'usuariosPorEmail' | 'telefonesEmUso' | 'conveniosExistentes'
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
  }[] = await ds.query(
    `SELECT u.id, lower(u.email) AS email, u.owner_id,
              (dp.id IS NOT NULL) AS tem_perfil
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
        },
      ]),
    ),
    telefonesEmUso: new Set(telefones.map((t) => t.phone)),
    conveniosExistentes: new Map(
      convenios.map((c) => [chaveDeNome(c.name), c.id]),
    ),
  };
}

/** Dry-run sem conexão: nada existente para conferir, dono fictício. */
export function contextoSemBanco(
  base: Omit<
    ContextoImportacao,
    'ownerId' | 'usuariosPorEmail' | 'telefonesEmUso' | 'conveniosExistentes'
  >,
): ContextoImportacao {
  return {
    ...base,
    ownerId: '00000000-0000-0000-0000-000000000000',
    usuariosPorEmail: new Map(),
    telefonesEmUso: new Set(),
    conveniosExistentes: new Map(),
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
    opcoes: { somenteComAtividade: opcoes.somenteComAtividade },
  };
}

export function salvarRelatorio(out: string, relatorio: Relatorio): string {
  mkdirSync(out, { recursive: true });
  const caminho = join(out, `relatorio-${relatorio.fase}.json`);
  writeFileSync(caminho, JSON.stringify(relatorio.paraJson(), null, 2));
  return caminho;
}
