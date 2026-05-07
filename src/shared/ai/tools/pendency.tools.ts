import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { In } from 'typeorm';
import { tokenizePii } from '../pii/tool-pii-helpers';

function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

function buildProtocolCandidates(identifier: string): string[] {
  const cleaned = identifier.trim();
  if (!cleaned) return [];

  const upper = cleaned.toUpperCase();
  const candidates = new Set<string>([upper]);

  if (upper.startsWith('SC-')) {
    const withoutPrefix = upper.slice(3).trim();
    if (withoutPrefix) candidates.add(withoutPrefix);
  } else {
    candidates.add(`SC-${upper}`);
  }

  return Array.from(candidates);
}

function normalizeProtocolDisplay(protocol: unknown): string {
  const value = String(protocol || '').trim();
  if (!value) return 'SC-N/D';
  return value.toUpperCase().startsWith('SC-')
    ? value.toUpperCase()
    : `SC-${value}`;
}

function mapPendencyToRecommendedAction(key: string): {
  action: string;
  minParams: string[];
} {
  switch (key) {
    case 'patient_data':
      return {
        action: 'update_patient_data',
        minParams: ['surgery_request_id', 'name|cpf|phone|birth_date'],
      };
    case 'hospital_data':
      return {
        action: 'set_hospital',
        minParams: ['surgery_request_id', 'hospital_name'],
      };
    case 'tuss_procedures':
      return {
        action: 'add_tuss_item',
        minParams: ['surgery_request_id', 'tuss_code', 'name'],
      };
    case 'opme_items':
      return {
        action: 'set_has_opme ou add_opme_item',
        minParams: ['surgery_request_id', 'has_opme=true|false'],
      };
    case 'medical_report':
      return {
        action: 'manage_report_sections',
        minParams: ['surgery_request_id', 'operation=create', 'title'],
      };
    case 'schedule_dates':
      return {
        action: 'update_date_options',
        minParams: ['surgery_request_id', 'date_options[]'],
      };
    case 'confirm_date':
      return {
        action: 'confirm_date',
        minParams: ['surgery_request_id', 'selected_date_index'],
      };
    case 'confirm_receipt':
      return {
        action: 'confirm_receipt',
        minParams: ['surgery_request_id', 'received_value', 'received_at'],
      };
    default:
      if (key.startsWith('doc_')) {
        return {
          action: 'attach_document_from_whatsapp',
          minParams: ['surgery_request_id', 'document_type?', 'confirm=true'],
        };
      }
      return {
        action: 'get_pendencies',
        minParams: ['surgery_request_id'],
      };
  }
}

async function resolveRequestByIdentifier(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: string,
  context: ToolContext,
): Promise<any | null> {
  const identifier = sanitizeIdentifier(identifierRaw);
  if (!identifier) return null;

  let request = null;

  if (identifier.match(/^[0-9a-f-]{36}$/i)) {
    request = await surgeryRequestRepo.findOneSimple({ id: identifier });
    if (request) return request;
  }

  for (const candidate of buildProtocolCandidates(identifier)) {
    request = await surgeryRequestRepo.findOneSimple({ protocol: candidate });
    if (request) return request;
  }

  const byName = await surgeryRequestRepo.findMany(
    { doctor_id: In(context.accessibleDoctorIds) as any },
    0,
    50,
  );
  const found = byName.find((r: any) =>
    r.patient?.name?.toLowerCase().includes(identifier.toLowerCase()),
  );

  return found || null;
}

export function buildPendencyTools(
  pendencyValidator: PendencyValidatorService,
  surgeryRequestRepo: SurgeryRequestRepository,
): AiTool[] {
  const getPendencies: AiTool = {
    name: 'get_pendencies',
    definition: {
      type: 'function',
      function: {
        name: 'get_pendencies',
        description:
          'Verifica pendências de uma solicitação cirúrgica e explica exatamente o que falta para avançar para a próxima etapa. Aceita ID UUID, protocolo (SC-XXXX ou XXXX) ou nome do paciente.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description:
                'Identificador da solicitação: UUID, protocolo SC-XXXX ou número',
            },
            identifier: {
              type: 'string',
              description:
                'Alias de identificador da solicitação: UUID, protocolo SC-XXXX ou nome do paciente',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const identifier =
        sanitizeIdentifier(args.surgery_request_id) ||
        sanitizeIdentifier(args.identifier);
      if (!identifier) return 'Parâmetro inválido: informe a solicitação.';

      const request = await resolveRequestByIdentifier(
        surgeryRequestRepo,
        identifier,
        context,
      );

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const result = await pendencyValidator.validateForStatus(request.id);
      const protocolToken = tokenizePii(
        context,
        'get_pendencies',
        'protocol',
        normalizeProtocolDisplay(request.protocol),
      );

      if (!result.pendencies.length) {
        return `A solicitação ${protocolToken} não tem pendências no status atual. Ela pode avançar para a próxima etapa.`;
      }

      const pending = result.pendencies.filter(
        (p) => !p.isComplete && !p.isOptional,
      );

      if (!pending.length) {
        return `A solicitação ${protocolToken} não possui pendências bloqueantes no status ${result.statusLabel}. Pode avançar para a próxima etapa.`;
      }

      const pendingLines = pending.flatMap((p) => {
        const undoneItems = (p.checkItems || []).filter((i) => !i.done);
        const recommendation = mapPendencyToRecommendedAction(p.key);

        const actionLines = [
          `  Ação recomendada agora: ${recommendation.action}`,
          `  Parâmetros mínimos: ${recommendation.minParams.join(', ')}`,
        ];

        if (!undoneItems.length) {
          return [`• ${p.name}`, ...actionLines];
        }

        return [
          `• ${p.name}`,
          ...undoneItems.map((item) => `  - ${item.label}`),
          ...actionLines,
        ];
      });

      const lines: string[] = [
        `Solicitação ${protocolToken} — ${result.statusLabel}`,
        `Status atual: ${result.statusLabel}`,
        'Para avançar, faça:',
        ...pendingLines,
      ];

      return lines.join('\n');
    },
  };

  return [getPendencies];
}
