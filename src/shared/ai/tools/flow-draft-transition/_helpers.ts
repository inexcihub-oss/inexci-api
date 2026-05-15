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
import { resolveSurgeryRequest } from '../_helpers/resolve-surgery-request';

const STATUS_LABELS: Record<number, string> = {
  1: 'Pendente',
  2: 'Enviada',
  3: 'Em Análise',
  4: 'Em Agendamento',
  5: 'Agendada',
  6: 'Realizada',
  7: 'Faturada',
  8: 'Finalizada',
  9: 'Encerrada',
};

/**
 * Bloqueia uso da tool quando não há draft ativo do tipo esperado. A
 * checagem complementa a filtragem do `ToolRegistryService`, que já
 * só expõe as tools de `mark_performed` quando há draft desse tipo.
 */
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
  /** Payload `blocked`/`error` pronto para retornar à tool. Null quando OK. */
  error: string | null;
  /** UUID real da SC quando resolvida (mesmo que `surgeryRequestId` tenha vindo como protocolo `SC-XXXX`). */
  resolvedId: string | null;
}

/**
 * Valida que a SC apontada pelo draft está no status esperado para a
 * transição. Retorna `{ error, resolvedId }` — `error` preenchido quando a
 * SC não existe ou está em outro status; `resolvedId` traz o UUID real (útil
 * quando o `surgeryRequestId` veio como protocolo SC-XXXX).
 *
 * Aceita tanto UUID quanto protocolo (`SC-XXXXXX`). Antes desta versão, se o
 * LLM gravasse o protocolo (formato amigável) no `surgeryRequestId` do draft,
 * a busca falhava com "Solicitação não encontrada" e o usuário ficava em
 * loop no WhatsApp.
 */
export async function assertCurrentStatusIs(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestId: string,
  expected: SurgeryRequestStatus,
): Promise<AssertStatusResult> {
  const sc = await resolveSurgeryRequest(surgeryRequestRepo, surgeryRequestId);
  if (!sc) {
    return {
      error: buildToolResult({
        status: 'error',
        message: 'Solicitação não encontrada.',
      }),
      resolvedId: null,
    };
  }
  if (sc.status !== expected) {
    return {
      error: buildToolResult({
        status: 'blocked',
        message: `A solicitação ${sc.protocol ?? sc.id} está no status "${STATUS_LABELS[sc.status] ?? sc.status}", não em "${STATUS_LABELS[expected]}". Essa transição não é mais válida.`,
      }),
      resolvedId: sc.id,
    };
  }
  return { error: null, resolvedId: sc.id };
}

/**
 * Lista os documentos cirúrgicos pós-operatórios já presentes na SC e
 * indica quais ainda faltam para que a transição possa acontecer.
 */
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
