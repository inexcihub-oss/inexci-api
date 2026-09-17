import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';

/** `unique_violation` do Postgres. */
const CHAVE_DUPLICADA = '23505';

interface DetalheDoDriver {
  code?: string;
  constraint?: string;
}

/**
 * Lê uma violação de unicidade do erro, ou `null` se for outra coisa.
 *
 * O `constraint` importa tanto quanto o código: "índice único violado" não diz
 * qual, e dois índices diferentes sobre a mesma tabela significam problemas
 * diferentes. O TypeORM ora expõe os campos do driver direto no erro, ora
 * embrulhados em `driverError` — depende de o comando ter passado pelo
 * `QueryRunner` ou pelo repositório.
 */
export function violacaoDeUnicidade(
  erro: unknown,
): { constraint?: string } | null {
  const falha = erro as DetalheDoDriver & { driverError?: DetalheDoDriver };
  const code = falha?.code ?? falha?.driverError?.code;
  if (code !== CHAVE_DUPLICADA) return null;

  return { constraint: falha?.constraint ?? falha?.driverError?.constraint };
}

/**
 * Mensagem para quando a criação da linha genérica esbarra num índice que não é
 * o dela. O caso conhecido é `uq_manufacturers_owner_name_active`: a conta ainda
 * tem a linha legada chamada "Outro", e o genérico usa esse mesmo nome. O erro
 * cru do Postgres não diz nada disso.
 */
export function mensagemDeGenericoBloqueado(
  entidade: 'fornecedor' | 'fabricante',
  ownerId: string,
  constraint: string,
): string {
  return (
    `Não foi possível criar o ${entidade} genérico "${GENERIC_OPTION_NAME}" da conta ${ownerId}: ` +
    `violação de "${constraint}". A conta provavelmente ainda tem o cadastro legado de mesmo nome — ` +
    'rode scripts/sql/outro-generico-aplicar.sql neste banco para unificá-lo.'
  );
}
