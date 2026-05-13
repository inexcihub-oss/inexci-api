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

/**
 * Tools de transição com draft que cobrem as transições "ricas"
 * onde o frontend abre um modal exigindo campos obrigatórios antes de mudar
 * o status:
 *
 *  - `send_sc_draft_*`              — PENDING → SENT (método de envio, destinatário/email)
 *  - `start_analysis_draft_*`       — SENT → IN_ANALYSIS (nº da operadora, data, cotações)
 *  - `accept_authorization_draft_*` — IN_ANALYSIS → IN_SCHEDULING (datas propostas)
 *  - `mark_performed_draft_*`       — SCHEDULED → PERFORMED (data + documentos cirúrgicos)
 *
 * A partir da Fase 5 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, os setters
 * per-type (`*_draft_set_*`), `*_draft_status` e `*_draft_cancel` foram
 * removidos em favor das tools globais `draft_update`, `draft_status` e
 * `draft_cancel` (`draft-generic.tools.ts`). Sobram apenas
 * `*_draft_preview`, `*_draft_commit` e a utility
 * `mark_performed_draft_check_docs` (que verifica documentos cirúrgicos).
 */
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
