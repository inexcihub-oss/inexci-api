import { maskPhone } from '../../../shared/utils/mask.util';

/**
 * Verificações de dado que precisam passar ANTES de uma migration restritiva
 * rodar. Existem porque `CREATE UNIQUE INDEX`, `ADD CONSTRAINT` e `SET NOT NULL`
 * quebram contra dado legado que já estava lá — e o erro do Postgres não diz
 * quais linhas colidem nem o que fazer. Foi o que derrubou o deploy de
 * 05/08/2026 (telefone repetido em `users`).
 *
 * Dois consumidores compartilham este registro:
 *  - a própria migration, que aborta antes de tentar o DDL;
 *  - `yarn migration:preflight`, que roda read-only contra produção antes de
 *    o deploy encostar na API.
 *
 * O SQL fica aqui, num lugar só: duplicá-lo faria o pré-flight aprovar um
 * deploy que a migration reprova. Entradas são **append-only** — uma migration
 * já aplicada em produção não pode ter sua checagem alterada retroativamente.
 */
export interface ConflitoDeDado {
  /** Identificador do conflito, com PII já mascarada (vai para log de deploy). */
  chave: string;
  /** Ids crus das linhas envolvidas — é o que o operador usa para agir. */
  ids: string;
}

export interface VerificacaoPreMigration {
  /** Nome da classe da migration que não pode rodar com o conflito de pé. */
  migration: string;
  descricao: string;
  /** SELECT read-only: cada linha devolvida é um conflito. */
  sql: string;
  /** O que o operador precisa fazer para destravar. */
  comoResolver: string;
  mapear(linhas: Record<string, unknown>[]): ConflitoDeDado[];
}

export const TELEFONE_DUPLICADO: VerificacaoPreMigration = {
  migration: 'AddUniqueIndexUserPhone1752300900000',
  descricao: 'telefone repetido entre usuários vivos em "users"',
  sql: `SELECT u."phone" AS phone,
               string_agg(u."id"::text, ', ' ORDER BY u."created_at") AS ids
          FROM "users" u
         WHERE u."phone" IS NOT NULL AND u."deleted_at" IS NULL
         GROUP BY u."phone"
        HAVING count(*) > 1
         ORDER BY u."phone"`,
  comoResolver:
    'Escolha qual conta mantém o número e troque o telefone da(s) outra(s) — ou desative-a(s) — antes de repetir o deploy.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: maskPhone(String(linha.phone ?? '')),
      ids: String(linha.ids ?? ''),
    })),
};

export const VERIFICACOES_PRE_MIGRATION: VerificacaoPreMigration[] = [
  TELEFONE_DUPLICADO,
];

/** Mensagem única, usada tanto no erro da migration quanto no pré-flight. */
export function montarDiagnostico(
  verificacao: VerificacaoPreMigration,
  conflitos: ConflitoDeDado[],
): string {
  return [
    `${verificacao.migration} bloqueada: ${conflitos.length} caso(s) de ${verificacao.descricao}.`,
    verificacao.comoResolver,
    'Conflitos (chave mascarada -> ids):',
    ...conflitos.map(({ chave, ids }) => `  ${chave} -> ${ids}`),
    'Para inspecionar: SELECT id, email, role, status, created_at FROM users WHERE id IN (...);',
  ].join('\n');
}

/**
 * Roda uma verificação e devolve os conflitos encontrados. `consultar` é
 * injetado porque os dois consumidores falam com o banco de formas diferentes:
 * a migration pelo `QueryRunner` do TypeORM, o pré-flight por um client `pg`.
 */
export async function verificar(
  verificacao: VerificacaoPreMigration,
  consultar: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<ConflitoDeDado[]> {
  const linhas = (await consultar(verificacao.sql)) ?? [];
  return verificacao.mapear(linhas);
}
