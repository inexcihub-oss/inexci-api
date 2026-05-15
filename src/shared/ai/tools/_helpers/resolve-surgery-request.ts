import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { detokenizeArg } from '../../pii/tool-pii-helpers';
import { ToolContext } from '../tool.interface';
import { buildProtocolCandidates } from '../protocol.helpers';

/**
 * Limpa um identificador (UUID ou protocolo SC-XXXX) vindo de tool args.
 */
function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

/**
 * Resolve uma SC a partir de um identificador que pode ser tanto UUID quanto
 * protocolo (`SC-468131`, `468131`, etc.). Não faz checagem de permissão.
 *
 * Usar em pontos onde a permissão já foi validada antes (ex.: dentro de um
 * draft que já carrega `surgeryRequestId` resolvido pelo `draft_update`) ou
 * em contextos administrativos.
 */
export async function resolveSurgeryRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: unknown,
): Promise<any | null> {
  const identifier = sanitizeIdentifier(identifierRaw);
  if (!identifier) return null;

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

  return request;
}

/**
 * Resolve uma SC e valida permissão do usuário (via `accessibleDoctorIds`).
 *
 * Aceita UUID ou protocolo. Detokeniza o argumento (caso venha mascarado pelo
 * cofre de PII) antes de buscar.
 *
 * @returns `{ request, error }` — `request` preenchido se ok; `error` com
 *  mensagem amigável quando não encontrou ou usuário sem acesso.
 */
export async function resolveAuthorizedRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: unknown,
  context: ToolContext,
): Promise<{ request: any | null; error: string | null }> {
  const detokenized = detokenizeArg(context, identifierRaw as any);
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
