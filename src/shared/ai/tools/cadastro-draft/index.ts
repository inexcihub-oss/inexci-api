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
