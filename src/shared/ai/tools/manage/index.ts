import { AiTool } from '../tool.interface';
import { ManageToolDeps } from './_types';
import { buildManageTussItemsTool } from './manage-tuss-items.tool';
import { buildManageOpmeItemsTool } from './manage-opme-items.tool';
import { buildManageDocumentsTool } from './manage-documents.tool';
import { buildManageReportImagesTool } from './manage-report-images.tool';
import { buildSetHealthPlanTool } from './set-health-plan.tool';

export type { ManageToolDeps } from './_types';

export function buildManageTools(deps: ManageToolDeps): AiTool[] {
  return [
    buildManageTussItemsTool(deps),
    buildManageOpmeItemsTool(deps),
    buildManageDocumentsTool(deps),
    buildManageReportImagesTool(deps),
    buildSetHealthPlanTool(deps),
  ];
}
