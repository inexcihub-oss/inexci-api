import { ConfigService } from '@nestjs/config';
import { ToolContext } from '../tool.interface';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestStatus } from '../../../../database/entities/surgery-request.entity';
import { DOCUMENT_KEYS } from '../../../constants/document-keys';
import { detokenizeArg } from '../../pii/tool-pii-helpers';
import { buildProtocolCandidates } from '../protocol.helpers';
import {
  TussService,
  TussResponse,
} from '../../../../modules/tuss/tuss.service';

export const REPORT_IMAGE_KEY = DOCUMENT_KEYS.REPORT_IMAGES;
export const REPORT_IMAGE_TYPE = 'exam_image';

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function asPositiveInt(value: unknown, fallback = 1): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isInteger(value)
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }

  const single = asNonEmptyString(value);
  if (!single) return [];

  return single
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

export function sanitizeAlphaNumKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export function classifyDocumentType(
  contentType: string | null | undefined,
  providedType: unknown,
): string {
  const typed = asNonEmptyString(providedType);
  if (typed) return typed;

  const mime = (contentType || '').toLowerCase();
  if (mime.includes('pdf')) return 'medical_report';
  if (mime.startsWith('image/')) return 'exam_image';
  if (mime.includes('word') || mime.includes('officedocument')) {
    return 'report_document';
  }
  return 'other_document';
}

export async function downloadInboundMedia(
  url: string,
  configService?: ConfigService,
): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  const sid = configService?.get<string>('TWILIO_ACCOUNT_SID', '') || '';
  const token = configService?.get<string>('TWILIO_AUTH_TOKEN', '') || '';

  const headers: Record<string, string> = {};
  if (sid && token) {
    headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`falha no download da mídia (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type');
  const urlPath = new URL(url).pathname;
  const fileNameFallback = urlPath.split('/').pop() || `media-${Date.now()}`;

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    fileName: fileNameFallback,
  };
}

export async function getAuthorizedRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestId: unknown,
  context: ToolContext,
): Promise<
  | { ok: false; message: string; request: null }
  | { ok: true; message: string; request: any }
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

  let request = null;
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

export function formatStatusLabel(status: number | null | undefined): string {
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

export function ensurePendingForMutation(request: any): string | null {
  if (request?.status !== SurgeryRequestStatus.PENDING) {
    return `Não é possível alterar essas informações: a solicitação está em "${formatStatusLabel(
      request?.status,
    )}". A partir de "Enviada" os dados ficam apenas como histórico (somente leitura).`;
  }
  return null;
}

/**
 * Tenta resolver código TUSS + descrição a partir do que o usuário forneceu.
 * Aceita: só código (resolve descrição), só nome (resolve código), ambos
 * (mantém ambos), nada (devolve erro).
 */
export function resolveTussFromCatalog(
  tussService: TussService | undefined,
  rawCode: string | null,
  rawName: string | null,
):
  | { status: 'ok'; tussCode: string; name: string }
  | { status: 'ambiguous'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'missing'; message: string } {
  if (!rawCode && !rawName) {
    return {
      status: 'missing',
      message:
        'Para adicionar TUSS, informe ao menos `tussCode` ou `name` (descrição). O sistema procura no catálogo e completa o que faltar.',
    };
  }

  if (!tussService) {
    if (!rawCode || !rawName) {
      return {
        status: 'missing',
        message: 'Para adicionar TUSS, informe `tussCode` e `name`.',
      };
    }
    return { status: 'ok', tussCode: rawCode, name: rawName };
  }

  if (rawCode) {
    const exact = tussService.findByExactCode(rawCode);
    if (exact) {
      return { status: 'ok', tussCode: exact.tussCode, name: exact.name };
    }

    const candidates = tussService.lookup(rawCode, 5);
    if (candidates.length === 0) {
      return {
        status: 'not_found',
        message: `Não encontrei o código TUSS "${rawCode}" no catálogo. Confira os dígitos ou descreva o procedimento para eu pesquisar.`,
      };
    }

    if (candidates.length === 1) {
      return {
        status: 'ok',
        tussCode: candidates[0].tussCode,
        name: candidates[0].name,
      };
    }

    return {
      status: 'ambiguous',
      message: [
        `Encontrei mais de um código TUSS começando com "${rawCode}":`,
        ...candidates.map((c) => `${c.tussCode} — ${c.name}`),
        'Confirme qual deles deve ser adicionado.',
      ].join('\n'),
    };
  }

  const candidates = tussService.lookup(rawName as string, 5);
  if (candidates.length === 0) {
    return {
      status: 'not_found',
      message: `Não encontrei nenhum código TUSS para "${rawName}". Tente um trecho diferente ou informe o código (mesmo parcial).`,
    };
  }

  if (candidates.length === 1) {
    return {
      status: 'ok',
      tussCode: candidates[0].tussCode,
      name: candidates[0].name,
    };
  }

  return {
    status: 'ambiguous',
    message: [
      `Encontrei mais de um código TUSS para "${rawName}":`,
      ...candidates.map((c: TussResponse) => `${c.tussCode} — ${c.name}`),
      'Confirme qual código você quer adicionar.',
    ].join('\n'),
  };
}
