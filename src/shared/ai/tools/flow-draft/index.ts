import { AiTool } from '../tool.interface';
import { FlowDraftDeps } from './_types';

import { buildInvoiceDraftPreviewTool } from './invoice/invoice-draft-preview.tool';
import { buildInvoiceDraftCommitTool } from './invoice/invoice-draft-commit.tool';

import { buildContestationDraftPreviewTool } from './contestation/contestation-draft-preview.tool';
import { buildContestationDraftCommitTool } from './contestation/contestation-draft-commit.tool';

import { buildSchedulingDraftPreviewTool } from './scheduling/scheduling-draft-preview.tool';
import { buildSchedulingDraftCommitTool } from './scheduling/scheduling-draft-commit.tool';

import { buildUpdateScDraftPreviewTool } from './update-sc/update-sc-draft-preview.tool';
import { buildUpdateScDraftCommitTool } from './update-sc/update-sc-draft-commit.tool';

export type { FlowDraftDeps } from './_types';

export function buildFlowDraftTools(deps: FlowDraftDeps): AiTool[] {
  return [
    buildInvoiceDraftPreviewTool(deps),
    buildInvoiceDraftCommitTool(deps),
    buildContestationDraftPreviewTool(deps),
    buildContestationDraftCommitTool(deps),
    buildSchedulingDraftPreviewTool(deps),
    buildSchedulingDraftCommitTool(deps),
    buildUpdateScDraftPreviewTool(deps),
    buildUpdateScDraftCommitTool(deps),
  ];
}
