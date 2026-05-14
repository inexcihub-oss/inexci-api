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

/**
 * Valida que a SC apontada pelo draft está no status esperado para a
 * transição. Retorna `null` se ok ou um payload `blocked` se a SC já
 * mudou de status ou não pode receber essa transição.
 */
export async function assertCurrentStatusIs(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestId: string,
  expected: SurgeryRequestStatus,
): Promise<string | null> {
  const sc = await surgeryRequestRepo.findOneSimple({ id: surgeryRequestId });
  if (!sc) {
    return buildToolResult({
      status: 'error',
      message: 'Solicitação não encontrada.',
    });
  }
  if (sc.status !== expected) {
    return buildToolResult({
      status: 'blocked',
      message: `A solicitação ${sc.protocol ?? sc.id} está no status "${STATUS_LABELS[sc.status] ?? sc.status}", não em "${STATUS_LABELS[expected]}". Essa transição não é mais válida.`,
    });
  }
  return null;
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
