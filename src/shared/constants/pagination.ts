/** Valores padrão para paginação */
export const PAGINATION_DEFAULTS = {
  SKIP: 0,
  TAKE: 10,
  /**
   * Teto por pagina. O frontend usa FETCH_ALL_TAKE=1000 deliberadamente em
   * varios seletores (pacientes, convenios, hospitais, fabricantes,
   * fornecedores, procedimentos, historico de SC por paciente) para carregar
   * a lista inteira de uma vez — um teto de 200 cortava silenciosamente
   * clinicas com mais de 200 registros desses seletores, sem nenhum aviso.
   * 1000 continua sendo um teto real e fixo: elimina por completo o achado
   * original (GET /patients?take=1000000 dumpava a base inteira em uma
   * requisicao), apenas alinhado ao uso legitimo ja existente no app.
   */
  MAX_TAKE: 1000,
} as const;
