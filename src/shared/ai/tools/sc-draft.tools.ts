/**
 * Re-export do builder de tools do rascunho de SC.
 *
 * A implementação foi extraída para `./sc-draft/`, com um arquivo `*.tool.ts`
 * por tool individual (Fase 2 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`).
 *
 * Este arquivo permanece como compatibilidade com importadores existentes
 * (specs antigos, `ai.module.ts`, etc.).
 */
export { buildScDraftTools, type ScDraftToolDeps } from './sc-draft/index';
