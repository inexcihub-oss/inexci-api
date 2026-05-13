import { AiTool } from '../tool.interface';
import { intentToDraftType } from '../../drafts/operation-draft.types';
import { ScDraftToolDeps } from './_types';
import { buildScDraftPreviewTool } from './sc-draft-preview.tool';
import { buildScDraftCommitTool } from './sc-draft-commit.tool';

export type { ScDraftToolDeps } from './_types';

/**
 * Tools de criação de SC. A partir da Fase 5 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, os setters per-type
 * (`sc_draft_set_*`), `sc_draft_status` e `sc_draft_cancel` foram removidos
 * em favor das tools globais `draft_update`, `draft_status` e `draft_cancel`
 * (`draft-generic.tools.ts`). Sobram apenas `*_draft_preview` e
 * `*_draft_commit` por tipo, que ainda exibem/persistem o draft estruturado.
 */
export function buildScDraftTools(deps: ScDraftToolDeps): AiTool[] {
  return [buildScDraftPreviewTool(deps), buildScDraftCommitTool(deps)];
}

void intentToDraftType;
