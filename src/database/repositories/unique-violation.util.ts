import { GENERIC_OPTION_NAME } from '../../shared/constants/generic-option';

const CHAVE_DUPLICADA = '23505';

interface DetalheDoDriver {
  code?: string;
  constraint?: string;
  message?: string;
}

export function violacaoDeUnicidade(
  erro: unknown,
): { constraint?: string } | null {
  if (!erro || typeof erro !== 'object') return null;
  const falha = erro as DetalheDoDriver & { driverError?: DetalheDoDriver };
  const code = falha.code ?? falha.driverError?.code;
  if (code !== CHAVE_DUPLICADA) return null;

  return { constraint: falha.constraint ?? falha.driverError?.constraint };
}

export function violouIndice(erro: unknown, indice: string): boolean {
  const violacao = violacaoDeUnicidade(erro);
  if (!violacao) return false;
  if (violacao.constraint === indice) return true;

  const falha = erro as DetalheDoDriver & { driverError?: DetalheDoDriver };
  return (
    (falha.message ?? '').includes(indice) ||
    (falha.driverError?.message ?? '').includes(indice)
  );
}

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
