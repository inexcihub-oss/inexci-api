/** Regras de negócio da plataforma INEXCI */
export const BUSINESS_RULES = {
  /** Número mínimo de cotações para mover solicitação para Em Análise */
  MIN_QUOTATIONS_FOR_ANALYSIS: 3,
  /** Dias de diferença mínimos para alertar sobre solicitação pendente */
  PENDING_ALERT_DAYS: 21,
} as const;
