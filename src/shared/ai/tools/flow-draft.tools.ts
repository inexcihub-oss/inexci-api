/**
 * Re-export do builder de tools de fluxo complexo (faturamento, contestação,
 * agendamento, update SC).
 *
 * A implementação foi extraída para `./flow-draft/` com um arquivo
 * `*.tool.ts` por tool (Fase 2 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`).
 *
 * Este arquivo permanece como compatibilidade com importadores existentes
 * (specs antigos, `ai.module.ts`, etc.).
 */
export { buildFlowDraftTools, type FlowDraftDeps } from './flow-draft/index';
