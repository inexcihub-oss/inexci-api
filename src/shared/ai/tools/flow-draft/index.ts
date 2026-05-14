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

/**
 * Tools de fluxo complexo que dependem de um draft estruturado:
 *  - `invoice_draft_*` — faturamento.
 *  - `contestation_draft_*` — contestação de autorização ou pagamento.
 *  - `scheduling_draft_*` — agendamento (sugerir opções e/ou confirmar data).
 *  - `update_sc_draft_*` — atualização de dados clínicos / administrativos / paciente.
 *
 * A partir da Fase 5 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, os setters
 * per-type (`*_draft_set_*`), `*_draft_status` e `*_draft_cancel` foram
 * removidos em favor das tools globais `draft_update`, `draft_status` e
 * `draft_cancel` (`draft-generic.tools.ts`). Sobram apenas
 * `*_draft_preview` e `*_draft_commit` por fluxo.
 */
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
