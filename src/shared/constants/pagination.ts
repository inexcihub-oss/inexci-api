/** Valores padrão para paginação */
export const PAGINATION_DEFAULTS = {
  SKIP: 0,
  TAKE: 10,
  /** Teto por pagina: acima disto e dump da base, nao paginacao. */
  MAX_TAKE: 200,
} as const;
