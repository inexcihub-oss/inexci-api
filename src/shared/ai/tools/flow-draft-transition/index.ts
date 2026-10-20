import { AiTool } from '../tool.interface';
import { FlowDraftTransitionDeps } from './_types';

import { buildSendScDraftPreviewTool } from './send-sc/send-sc-draft-preview.tool';
import { buildSendScDraftCommitTool } from './send-sc/send-sc-draft-commit.tool';

import { buildStartAnalysisDraftPreviewTool } from './start-analysis/start-analysis-draft-preview.tool';
import { buildStartAnalysisDraftCommitTool } from './start-analysis/start-analysis-draft-commit.tool';

import { buildAcceptAuthorizationDraftPreviewTool } from './accept-authorization/accept-authorization-draft-preview.tool';
import { buildAcceptAuthorizationDraftCommitTool } from './accept-authorization/accept-authorization-draft-commit.tool';

import { buildMarkPerformedDraftCheckDocsTool } from './mark-performed/mark-performed-draft-check-docs.tool';
import { buildMarkPerformedDraftPreviewTool } from './mark-performed/mark-performed-draft-preview.tool';
import { buildMarkPerformedDraftCommitTool } from './mark-performed/mark-performed-draft-commit.tool';

export type { FlowDraftTransitionDeps } from './_types';

export function buildFlowDraftTransitionTools(
  deps: FlowDraftTransitionDeps,
): AiTool[] {
  return [
    buildSendScDraftPreviewTool(deps),
    buildSendScDraftCommitTool(deps),
    buildStartAnalysisDraftPreviewTool(deps),
    buildStartAnalysisDraftCommitTool(deps),
    buildAcceptAuthorizationDraftPreviewTool(deps),
    buildAcceptAuthorizationDraftCommitTool(deps),
    buildMarkPerformedDraftCheckDocsTool(deps),
    buildMarkPerformedDraftPreviewTool(deps),
    buildMarkPerformedDraftCommitTool(deps),
  ];
}
