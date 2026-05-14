import { AiTool } from '../tool.interface';
import { CadastroDraftDeps } from './_types';
import { buildPatientDraftPreviewTool } from './patient/patient-draft-preview.tool';
import { buildPatientDraftCommitTool } from './patient/patient-draft-commit.tool';
import { buildHospitalDraftPreviewTool } from './hospital/hospital-draft-preview.tool';
import { buildHospitalDraftCommitTool } from './hospital/hospital-draft-commit.tool';
import { buildHealthPlanDraftPreviewTool } from './health-plan/health-plan-draft-preview.tool';
import { buildHealthPlanDraftCommitTool } from './health-plan/health-plan-draft-commit.tool';
import { buildProcedureDraftPreviewTool } from './procedure/procedure-draft-preview.tool';
import { buildProcedureDraftCommitTool } from './procedure/procedure-draft-commit.tool';

export type { CadastroDraftDeps } from './_types';

/**
 * Tools de cadastros estruturados como sub-drafts. A partir da Fase 5 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, os setters per-type
 * (`*_draft_set_*`), `*_draft_status` e `*_draft_cancel` foram removidos
 * em favor das tools globais `draft_update`, `draft_status` e `draft_cancel`
 * (`draft-generic.tools.ts`). Sobram apenas `*_draft_preview` e
 * `*_draft_commit` por entidade. Ordem preservada para estabilidade do
 * prompt caching da OpenAI (ver `PROMPT_VERSION`).
 */
export function buildCadastroDraftTools(deps: CadastroDraftDeps): AiTool[] {
  return [
    buildPatientDraftPreviewTool(deps),
    buildPatientDraftCommitTool(deps),
    buildHospitalDraftPreviewTool(deps),
    buildHospitalDraftCommitTool(deps),
    buildHealthPlanDraftPreviewTool(deps),
    buildHealthPlanDraftCommitTool(deps),
    buildProcedureDraftPreviewTool(deps),
    buildProcedureDraftCommitTool(deps),
  ];
}
