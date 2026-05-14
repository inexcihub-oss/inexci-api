/**
 * Re-export do builder de tools de cadastro (patient/hospital/health_plan/
 * procedure drafts).
 *
 * A implementação foi extraída para `./cadastro-draft/`, com um arquivo
 * `*.tool.ts` por tool individual e subpastas por entidade (Fase 2 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`).
 */
export {
  buildCadastroDraftTools,
  type CadastroDraftDeps,
} from './cadastro-draft/index';
