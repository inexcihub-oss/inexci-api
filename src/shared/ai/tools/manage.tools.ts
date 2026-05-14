/**
 * Re-export do builder de tools de gerenciamento (TUSS / OPME / documentos /
 * imagens de laudo / set_health_plan).
 *
 * A implementação foi extraída para `./manage/`, com um arquivo `*.tool.ts`
 * por tool (Fase 2 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`).
 */
export { buildManageTools, type ManageToolDeps } from './manage/index';
