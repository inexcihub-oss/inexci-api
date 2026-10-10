import { ToolContext } from '../tool.interface';
import { OperationDraftService } from '../../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { DocumentRepository } from '../../../../database/repositories/document.repository';
import { SurgeryRequestStatus } from '../../../../database/entities/surgery-request.entity';
import {
  POST_SURGERY_REQUIRED_DOCS,
  PostSurgeryRequiredDoc,
} from '../../../../config/post-surgery-documents.config';
import { buildToolResult } from '../tool-result';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { resolveAuthorizedRequest } from '../helpers/surgery-request-access';
import { getStatusLabel } from '../../../utils/status';

export async function guardDraft(
  draftService: OperationDraftService,
  context: ToolContext,
  type: OperationDraftType,
): Promise<string | null> {
  const current = await draftService.getCurrent(context.conversationId);
  if (!current) {
    return buildToolResult({
      status: 'blocked',
      message: `Não há rascunho de "${type}" ativo. Chame \`plan_actions\` com intent="${type}" primeiro.`,
    });
  }
  if (current.type !== type) {
    return buildToolResult({
      status: 'blocked',
      message: `O rascunho ativo é do tipo "${current.type}", não "${type}". Conclua ou cancele antes.`,
    });
  }
  return null;
}

export interface AssertStatusResult {
  error: string | null;
  resolvedId: string | null;
}

export async function assertCurrentStatusIs(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestId: string,
  expected: SurgeryRequestStatus,
  context: ToolContext,
): Promise<AssertStatusResult> {
  const { request: sc, error: erroDeAcesso } = await resolveAuthorizedRequest(
    surgeryRequestRepo,
    surgeryRequestId,
    context,
  );
  if (!sc) {
    return {
      error: buildToolResult({
        status: 'error',
        message: erroDeAcesso,
      }),
      resolvedId: null,
    };
  }
  if (sc.status !== expected) {
    return {
      error: buildToolResult({
        status: 'blocked',
        message: `A solicitação ${sc.protocol ?? sc.id} está no status "${getStatusLabel(sc.status)}", não em "${getStatusLabel(expected)}". Essa transição não é mais válida.`,
      }),
      resolvedId: sc.id,
    };
  }
  return { error: null, resolvedId: sc.id };
}

export function extractTransitionErrorMessage(
  err: any,
  defaultPrefix: string,
): string {
  const response =
    typeof err?.getResponse === 'function' ? err.getResponse() : err?.response;

  if (response && typeof response === 'object') {
    const pendencies: Array<{ key: string; name: string }> = Array.isArray(
      response.pendencies,
    )
      ? response.pendencies
      : [];
    const baseMessage: string =
      typeof response.message === 'string'
        ? response.message
        : (err?.message ?? 'erro desconhecido');

    if (pendencies.length > 0) {
      const list = pendencies.map((p) => p.name).join('; ');
      return `${baseMessage} Pendências: ${list}.`;
    }
    return baseMessage;
  }

  return `${defaultPrefix}: ${err?.message || 'erro desconhecido'}`;
}

export async function checkPostSurgeryDocuments(
  documentRepo: DocumentRepository,
  surgeryRequestId: string,
): Promise<{
  missing: PostSurgeryRequiredDoc[];
  present: string[];
}> {
  const docs = await documentRepo.findMany({ surgeryRequestId });
  const presentKeys = new Set(
    (docs ?? []).map((d) => d.key).filter((k): k is string => !!k),
  );
  const missing = POST_SURGERY_REQUIRED_DOCS.filter(
    (d) => d.required && !presentKeys.has(d.type),
  );
  return { missing, present: Array.from(presentKeys) };
}
