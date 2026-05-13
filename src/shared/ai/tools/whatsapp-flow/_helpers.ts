import { ToolContext } from '../tool.interface';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from '../../../../database/entities/surgery-request.entity';
import { detokenizeArg } from '../../pii/tool-pii-helpers';
import { buildProtocolCandidates } from '../protocol.helpers';
import DOCUMENT_TYPES from '../../../../common/document-types.common';
import {
  normalizePhoneDigits,
  normalizeCpfSimple,
} from '../helpers/normalizers';

export const SUPPORTED_ATTACH_DOCUMENT_TYPES = Object.values(DOCUMENT_TYPES);

export const normalizeCpf = normalizeCpfSimple;
export const normalizePhone = normalizePhoneDigits;

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function asValidDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return value;
}

export function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function formatDatePtBr(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('pt-BR');
}

export function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

export function statusLabel(status: number | null | undefined): string {
  switch (status) {
    case 1:
      return 'Pendente';
    case 2:
      return 'Enviada';
    case 3:
      return 'Em Análise';
    case 4:
      return 'Em Agendamento';
    case 5:
      return 'Agendada';
    case 6:
      return 'Realizada';
    case 7:
      return 'Faturada';
    case 8:
      return 'Finalizada';
    case 9:
      return 'Encerrada';
    default:
      return String(status ?? 'Desconhecido');
  }
}

/**
 * Espelha a regra do frontend (`statusNum >= 2`): informações gerais, TUSS,
 * OPME e laudo só podem ser alterados enquanto a SC está em "Pendente". A
 * partir de "Enviada" tudo vira histórico (somente leitura).
 */
export function ensurePendingForMutation(request: any): string | null {
  if (request?.status !== SurgeryRequestStatus.PENDING) {
    return `Não é possível alterar essas informações: a solicitação está em "${statusLabel(
      request?.status,
    )}". A partir de "Enviada" os dados ficam apenas como histórico (somente leitura).`;
  }
  return null;
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

  const detokenized = detokenizeArg(context, surgeryRequestId as any);
  const identifier = sanitizeIdentifier(detokenized ?? surgeryRequestId);
  if (!identifier) {
    return {
      ok: false,
      message: 'Parâmetro inválido: informe `surgeryRequestId` válido.',
      request: null,
    };
  }

  let request: SurgeryRequest | null = null;
  if (identifier.match(/^[0-9a-f-]{36}$/i)) {
    request = await surgeryRequestRepo.findOneSimple({ id: identifier });
  }

  if (!request) {
    for (const candidate of buildProtocolCandidates(identifier)) {
      request = await surgeryRequestRepo.findOneSimple({ protocol: candidate });
      if (request) break;
    }
  }

  if (!request) {
    return {
      ok: false,
      message: 'Solicitação não encontrada.',
      request: null,
    };
  }

  if (!context.accessibleDoctorIds.includes(request.doctorId)) {
    return {
      ok: false,
      message: 'Você não tem permissão para acessar essa solicitação.',
      request: null,
    };
  }

  return { ok: true, message: '', request };
}

export function documentTypeKeyToLabel(typeKey: string): string {
  const labels: Record<string, string> = {
    personal_document: 'Documento pessoal',
    exam_report: 'Laudo de exame',
    medical_report: 'Laudo médico',
    authorization_guide: 'Guia de autorização',
    surgery_room: 'Sala cirúrgica',
    surgery_images: 'Imagens da cirurgia',
    surgery_auth_document: 'Autorização cirúrgica',
    invoice_protocol: 'Protocolo de faturamento',
    receipt_document: 'Comprovante de recebimento',
    contest_file: 'Anexo de contestação',
    additional_document: 'Documento adicional',
  };
  return labels[typeKey] ?? typeKey;
}
