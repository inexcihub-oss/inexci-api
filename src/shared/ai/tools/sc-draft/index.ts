import { AiTool } from '../tool.interface';
import { intentToDraftType } from '../../drafts/operation-draft.types';
import { ScDraftToolDeps } from './_types';
import { buildScDraftPreviewTool } from './sc-draft-preview.tool';
import { buildScDraftCommitTool } from './sc-draft-commit.tool';

export type { ScDraftToolDeps } from './_types';

export function buildScDraftTools(deps: ScDraftToolDeps): AiTool[] {
  return [buildScDraftPreviewTool(deps), buildScDraftCommitTool(deps)];
}

void intentToDraftType;
