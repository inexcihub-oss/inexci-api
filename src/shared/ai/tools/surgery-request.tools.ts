import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';
import { In } from 'typeorm';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';

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

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Baixa',
  2: 'Média',
  3: 'Alta',
  4: 'Urgente',
};

function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

function normalizeProtocolDisplay(protocol: unknown): string {
  const value = String(protocol || '').trim();
  if (!value) return 'SC-N/D';
  return value.toUpperCase().startsWith('SC-')
    ? value.toUpperCase()
    : `SC-${value}`;
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

async function resolveRequestByIdentifier(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: string,
  context: ToolContext,
): Promise<any | null> {
  const identifier = sanitizeIdentifier(identifierRaw);
  if (!identifier) return null;

  let request = null;

  const protocolCandidates = buildProtocolCandidates(identifier);
  for (const candidate of protocolCandidates) {
    request = await surgeryRequestRepo.findOneSimple({ protocol: candidate });
    if (request) break;
  }

  if (!request && identifier.match(/^[0-9a-f-]{36}$/i)) {
    request = await surgeryRequestRepo.findOneSimple({ id: identifier });
  }

  if (!request) {
    const all = await surgeryRequestRepo.findMany(
      { doctor_id: In(context.accessibleDoctorIds) as any },
      0,
      50,
    );
    const found = all.find((r: any) =>
      r.patient?.name?.toLowerCase().includes(identifier.toLowerCase()),
    );
    if (found) request = found;
  }

  return request;
}

export function buildSurgeryRequestTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  pendencyValidator?: PendencyValidatorService,
): AiTool[] {
  const getSurgeryRequestStatus: AiTool = {
    name: 'get_surgery_request_status',
    definition: {
      type: 'function',
      function: {
        name: 'get_surgery_request_status',
        description:
          'Busca o status e detalhes resumidos de uma solicitação cirúrgica. Aceita ID UUID ou número de protocolo (ex: SC-0042) ou nome do paciente.',
        parameters: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description:
                'ID UUID, número do protocolo (SC-XXXX) ou nome do paciente',
            },
          },
          required: ['identifier'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return 'Você precisa estar cadastrado para consultar solicitações.';

      const { identifier } = args as { identifier: string };
      const resolvedRequest = await resolveRequestByIdentifier(
        surgeryRequestRepo,
        identifier,
        context,
      );

      let request = resolvedRequest;
      if (resolvedRequest?.id) {
        const fullRequest = await surgeryRequestRepo.findOne({
          id: resolvedRequest.id,
        });
        if (fullRequest) request = fullRequest as any;
      }

      if (!request) {
        return `Não encontrei uma solicitação com o identificador "${identifier}". Verifique o protocolo ou o nome do paciente.`;
      }

      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const status = STATUS_LABELS[request.status] || String(request.status);
      const priority =
        PRIORITY_LABELS[request.priority as any] || String(request.priority);
      const protocol = normalizeProtocolDisplay(request.protocol);

      let pendencyLines: string[] = [];
      if (pendencyValidator && request.id) {
        try {
          const validation = await pendencyValidator.validateForStatus(
            request.id,
          );
          const blockingPending = validation.pendencies.filter(
            (p) => !p.isComplete && !p.isOptional,
          );

          if (!blockingPending.length) {
            pendencyLines = [
              'Próximo passo: sem bloqueios para avançar de etapa.',
            ];
          } else {
            const actions = blockingPending.flatMap((p) => {
              const undone = (p.checkItems || []).filter((item) => !item.done);
              if (!undone.length) return [`• ${p.name}`];
              return [
                `• ${p.name}`,
                ...undone.map((item) => `  - ${item.label}`),
              ];
            });

            pendencyLines = ['Para avançar de etapa, faça:', ...actions];
          }
        } catch {
          pendencyLines = [
            'Próximo passo: consulte as pendências para avançar a etapa.',
          ];
        }
      }

      return [
        `📋 *Solicitação ${protocol}*`,
        `Status: ${status}`,
        `Prioridade: ${priority}`,
        `Paciente: ${(request as any).patient?.name || request.patient_id}`,
        `Hospital: ${(request as any).hospital?.name || request.hospital_id || 'Não definido'}`,
        `Convênio: ${(request as any).health_plan?.name || request.health_plan_id || 'Não definido'}`,
        `Data da cirurgia: ${request.surgery_date ? new Date(request.surgery_date).toLocaleDateString('pt-BR') : request.date_call ? new Date(request.date_call).toLocaleDateString('pt-BR') : 'Não agendada'}`,
        ...pendencyLines,
      ].join('\n');
    },
  };

  const listSurgeryRequests: AiTool = {
    name: 'list_surgery_requests',
    definition: {
      type: 'function',
      function: {
        name: 'list_surgery_requests',
        description:
          'Lista as solicitações cirúrgicas do usuário com filtro opcional por status.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description:
                'Status para filtrar: pendente, enviada, em_analise, em_agendamento, agendada, realizada, faturada, finalizada, encerrada',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima de resultados (padrão: 5)',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return 'Você precisa estar cadastrado para consultar solicitações.';

      const STATUS_MAP: Record<string, number> = {
        pendente: 1,
        enviada: 2,
        em_analise: 3,
        em_agendamento: 4,
        agendada: 5,
        realizada: 6,
        faturada: 7,
        finalizada: 8,
        encerrada: 9,
      };

      const limit = Math.min((args.limit as number) || 5, 10);
      const statusNum = args.status
        ? STATUS_MAP[String(args.status).toLowerCase()]
        : undefined;

      if (!context.accessibleDoctorIds.length) {
        return 'Nenhum médico acessível encontrado.';
      }

      const where: any = { doctor_id: context.accessibleDoctorIds[0] };
      if (statusNum) where.status = statusNum as SurgeryRequestStatus;

      const requests = await surgeryRequestRepo.findMany(where, 0, limit);

      if (!requests.length) {
        return args.status
          ? `Nenhuma solicitação com status "${args.status}" encontrada.`
          : 'Nenhuma solicitação encontrada.';
      }

      const lines = requests.map(
        (r: any) =>
          `• ${normalizeProtocolDisplay(r.protocol)} — ${r.patient?.name || 'Paciente'} — ${STATUS_LABELS[r.status] || r.status}`,
      );
      return `📋 *Suas solicitações:*\n${lines.join('\n')}`;
    },
  };

  const getDocuments: AiTool = {
    name: 'get_documents',
    definition: {
      type: 'function',
      function: {
        name: 'get_documents',
        description:
          'Lista os documentos anexados a uma solicitação cirúrgica.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const rawIdentifier = String(args.surgery_request_id || '');
      const byId = sanitizeIdentifier(rawIdentifier);

      let request = await surgeryRequestRepo.findOne({ id: byId });
      if (!request) {
        for (const candidate of buildProtocolCandidates(byId)) {
          const byProtocol = await surgeryRequestRepo.findOneSimple({
            protocol: candidate,
          });
          if (byProtocol?.id) {
            request = await surgeryRequestRepo.findOne({ id: byProtocol.id });
            if (request) break;
          }
        }
      }

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const docs = (request as any).documents || [];
      if (!docs.length) return 'Nenhum documento anexado a essa solicitação.';

      const lines = docs.map(
        (d: any) =>
          `• ${d.name || d.key || 'Documento'} — ${d.folder || ''} — ${d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : ''}`,
      );
      return `📄 *Documentos:*\n${lines.join('\n')}`;
    },
  };

  const getOpmeItems: AiTool = {
    name: 'get_opme_items',
    definition: {
      type: 'function',
      function: {
        name: 'get_opme_items',
        description: 'Lista os itens OPME de uma solicitação cirúrgica.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const rawIdentifier = String(args.surgery_request_id || '');
      const byId = sanitizeIdentifier(rawIdentifier);

      let request = await surgeryRequestRepo.findOne({ id: byId });
      if (!request) {
        for (const candidate of buildProtocolCandidates(byId)) {
          const byProtocol = await surgeryRequestRepo.findOneSimple({
            protocol: candidate,
          });
          if (byProtocol?.id) {
            request = await surgeryRequestRepo.findOne({ id: byProtocol.id });
            if (request) break;
          }
        }
      }

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const items = (request as any).opme_items || [];
      if (!items.length)
        return 'Nenhum item OPME cadastrado para essa solicitação.';

      const lines = items.map(
        (i: any) =>
          `• ${i.name || i.description || 'Item'} — Qtd: ${i.quantity || 1}${i.supplier ? ` — Fornecedor: ${i.supplier}` : ''}`,
      );
      return `🔩 *Itens OPME:*\n${lines.join('\n')}`;
    },
  };

  return [
    getSurgeryRequestStatus,
    listSurgeryRequests,
    getDocuments,
    getOpmeItems,
  ];
}
