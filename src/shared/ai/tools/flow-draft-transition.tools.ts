/**
 * Re-export do builder de tools de transições com draft (PENDING→SENT,
 * SENT→IN_ANALYSIS, IN_ANALYSIS→IN_SCHEDULING, SCHEDULED→PERFORMED).
 *
 * A implementação foi extraída para `./flow-draft-transition/` com um
 * arquivo `*.tool.ts` por tool (Fase 2 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`).
 *
 * Este arquivo permanece como compatibilidade com importadores existentes
 * (specs antigos, `ai.module.ts`, etc.).
 */
export {
  buildFlowDraftTransitionTools,
  type FlowDraftTransitionDeps,
} from './flow-draft-transition/index';
