/**
 * Regras que dependem dos ids **deste** export do Feegow (cliente Dr. Fabio /
 * Segall Vital Care), levantadas em `RELATORIO-MIGRACAO-FEEGOW-DR-FABIO.md`.
 * Outro cliente do Feegow terá outros ids: revisar este arquivo antes de
 * reaproveitar o importador.
 */

/**
 * "Convênios" que na verdade são tipos de consulta: CONSULTA PARTICULAR
 * CONSULTORIO (5), PRIMEIRA CONSULTA -TRIAGEM (11), REVER EXAMES / RETORNO (12).
 */
export const CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA = new Set(['5', '11', '12']);

/** Procedimento "PRIMEIRA CONSULTA -TRIAGEM" → primeira consulta. */
export const PROCEDIMENTOS_DE_PRIMEIRA_VEZ = new Set(['28']);

/** "REVER EXAMES / RETORNO" (30) e "CONSULTA PÓS CIRURGICA" (24) → retorno. */
export const PROCEDIMENTOS_DE_RETORNO = new Set(['30', '24']);

/**
 * Profissional cujas consultas são sessões de acompanhamento (técnica de
 * enfermagem do protocolo de dor, id 9) → `follow_up`.
 */
export const PROFISSIONAIS_DE_ACOMPANHAMENTO = new Set(['9']);
