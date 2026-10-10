import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from '../../../../database/entities/surgery-request.entity';
import { ActivityType } from '../../../../database/entities/surgery-request-activity.entity';
import { getStatusLabel } from '../../../utils/status';
import { detokenizeArg } from '../../pii/tool-pii-helpers';
import { ToolContext } from '../tool.interface';
import { buildProtocolCandidates } from '../protocol.helpers';
import { In } from 'typeorm';

const UUID_REGEX = /^[0-9a-f-]{36}$/i;

export function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

export async function resolveSurgeryRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: unknown,
): Promise<SurgeryRequest | null> {
  const identifier = sanitizeIdentifier(identifierRaw);
  if (!identifier) return null;

  let request: SurgeryRequest | null = null;
  if (UUID_REGEX.test(identifier)) {
    request = await surgeryRequestRepo.findOneSimple({ id: identifier });
  }

  if (!request) {
    for (const candidate of buildProtocolCandidates(identifier)) {
      request = await surgeryRequestRepo.findOneSimple({ protocol: candidate });
      if (request) break;
    }
  }

  return request;
}

export async function resolveRequestByIdentifierOrPatientName(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: string,
  context: ToolContext,
): Promise<SurgeryRequest | null> {
  const detokenized = detokenizeArg(context, identifierRaw);
  const identifier = sanitizeIdentifier(detokenized ?? identifierRaw);
  if (!identifier) return null;

  const direct = await resolveSurgeryRequest(surgeryRequestRepo, identifier);
  if (direct) return direct;

  const accessible = await surgeryRequestRepo.findMany(
    { doctorId: In(context.accessibleDoctorIds) },
    0,
    50,
  );
  const needle = identifier.toLowerCase();
  return (
    accessible.find((r) => r.patient?.name?.toLowerCase().includes(needle)) ??
    null
  );
}

export async function resolveAuthorizedRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: unknown,
  context: ToolContext,
): Promise<
  { request: SurgeryRequest; error: null } | { request: null; error: string }
> {
  const detokenized = detokenizeArg(
    context,
    identifierRaw as string | number | null | undefined,
  );
  const identifier = sanitizeIdentifier(detokenized ?? identifierRaw);
  if (!identifier) {
    return {
      request: null,
      error: 'Parâmetro inválido: informe a solicitação.',
    };
  }

  const request = await resolveSurgeryRequest(surgeryRequestRepo, identifier);

  if (!request) {
    return { request: null, error: 'Solicitação não encontrada.' };
  }

  if (!context.accessibleDoctorIds.includes(request.doctorId)) {
    return {
      request: null,
      error: 'Você não tem permissão para acessar essa solicitação.',
    };
  }

  return { request, error: null };
}

export async function getAuthorizedRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestId: unknown,
  context: ToolContext,
): Promise<
  | { ok: false; message: string; request: null }
  | { ok: true; message: string; request: SurgeryRequest }
> {
  if (!context.userId) {
    return { ok: false, message: 'Acesso negado.', request: null };
  }
  const { request, error } = await resolveAuthorizedRequest(
    surgeryRequestRepo,
    surgeryRequestId,
    context,
  );
  if (!request) return { ok: false, message: error, request: null };
  return { ok: true, message: '', request };
}

export function ensurePendingForMutation(
  request: Pick<SurgeryRequest, 'status'> | null | undefined,
): string | null {
  if (request?.status !== SurgeryRequestStatus.PENDING) {
    const label =
      request?.status == null ? 'Desconhecido' : getStatusLabel(request.status);
    return `Não é possível alterar essas informações: a solicitação está em "${label}". A partir de "Enviada" os dados ficam apenas como histórico (somente leitura).`;
  }
  return null;
}

export async function recordAiActivity(
  activityRepo: SurgeryRequestActivityRepository,
  context: Pick<ToolContext, 'userId'>,
  surgeryRequestId: string,
  message: string,
): Promise<void> {
  await activityRepo.create({
    surgeryRequestId,
    userId: context.userId as string,
    type: ActivityType.SYSTEM,
    content: `[WhatsApp IA] ${message}`,
  });
}
