import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { Permission } from 'src/shared/permissions';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestPriority,
  SurgeryRequestStatus,
} from '../../../database/entities/surgery-request.entity';
import { FindOptionsWhere, In } from 'typeorm';
import { getStatusLabel } from '../../utils/status';
import { resolveRequestByIdentifierOrPatientName } from './helpers/surgery-request-access';
import { Logger } from '@nestjs/common';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { tokenizePii } from '../pii/tool-pii-helpers';
import { stripScPrefix } from './protocol.helpers';

const logger = new Logger('SurgeryRequestTools');

const PRIORITY_LABELS: Record<SurgeryRequestPriority, string> = {
  [SurgeryRequestPriority.LOW]: 'Baixa',
  [SurgeryRequestPriority.MEDIUM]: 'Média',
  [SurgeryRequestPriority.HIGH]: 'Alta',
  [SurgeryRequestPriority.URGENT]: 'Urgente',
};

const STATUS_FILTER: Record<string, SurgeryRequestStatus> = {
  pendente: SurgeryRequestStatus.PENDING,
  enviada: SurgeryRequestStatus.SENT,
  em_analise: SurgeryRequestStatus.IN_ANALYSIS,
  em_agendamento: SurgeryRequestStatus.IN_SCHEDULING,
  agendada: SurgeryRequestStatus.SCHEDULED,
  realizada: SurgeryRequestStatus.PERFORMED,
  faturada: SurgeryRequestStatus.INVOICED,
  finalizada: SurgeryRequestStatus.FINALIZED,
  encerrada: SurgeryRequestStatus.CLOSED,
};

const ORDERED_STATUSES: SurgeryRequestStatus[] = [
  SurgeryRequestStatus.PENDING,
  SurgeryRequestStatus.SENT,
  SurgeryRequestStatus.IN_ANALYSIS,
  SurgeryRequestStatus.IN_SCHEDULING,
  SurgeryRequestStatus.SCHEDULED,
  SurgeryRequestStatus.PERFORMED,
  SurgeryRequestStatus.INVOICED,
  SurgeryRequestStatus.FINALIZED,
  SurgeryRequestStatus.CLOSED,
];

export function buildSurgeryRequestTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  pendencyValidator: PendencyValidatorService,
): AiTool[] {
  const querySurgeryRequests: AiTool = {
    name: 'query_surgery_requests',
    requiredPermission: Permission.SOLICITACOES,
    definition: {
      type: 'function',
      function: {
        name: 'query_surgery_requests',
        description:
          'Consulta solicitações cirúrgicas. Sem `identifier` lista todas as SCs do usuário agrupadas por status (Pendente → Encerrada), até 200. Com `identifier` retorna o detalhe completo de uma SC (status, prioridade, paciente, hospital, convênio, CID, data e pendências). Aceita UUID, protocolo (SC-XXXX) ou nome do paciente.',
        parameters: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description:
                'UUID, protocolo (SC-XXXX) ou nome do paciente para buscar uma SC específica. Omitir para listar todas.',
            },
            status: {
              type: 'string',
              description:
                'Filtro de status para listagem (opcional): pendente, enviada, em_analise, em_agendamento, agendada, realizada, faturada, finalizada, encerrada.',
            },
            limit: {
              type: 'number',
              description:
                'Quantidade máxima de resultados na listagem (padrão 50, máximo 200).',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return 'Você precisa estar cadastrado para consultar solicitações.';

      const identifierRaw = args.identifier;

      if (identifierRaw) {
        const resolvedRequest = await resolveRequestByIdentifierOrPatientName(
          surgeryRequestRepo,
          String(identifierRaw),
          context,
        );

        let request: SurgeryRequest | null = resolvedRequest;
        if (resolvedRequest?.id) {
          const fullRequest = await surgeryRequestRepo.findOne({
            id: resolvedRequest.id,
          });
          if (fullRequest) request = fullRequest;
        }

        if (!request) {
          return 'Não encontrei essa solicitação. Verifique o número do protocolo ou o nome do paciente e tente novamente.';
        }

        if (!context.accessibleDoctorIds.includes(request.doctorId)) {
          return 'Você não tem permissão para acessar essa solicitação.';
        }

        const statusLabel = getStatusLabel(request.status);
        const priority =
          PRIORITY_LABELS[request.priority] || String(request.priority);
        const TOOL = 'query_surgery_requests';
        const protocolToken = tokenizePii(
          context,
          TOOL,
          'protocol',
          stripScPrefix(request.protocol),
        );
        const protocolDisplay = `SC-${protocolToken}`;
        const patientLabel = String(
          request.patient?.name || request.patientId || 'Não informado',
        );
        const hospitalLabel = request.hospital?.name
          ? String(request.hospital.name)
          : 'Não definido';
        const healthPlanLabel = request.healthPlan?.name
          ? String(request.healthPlan.name)
          : 'Não definido';
        const surgeryDateRaw = request.surgeryDate || request.dateCall;
        const surgeryDateToken = surgeryDateRaw
          ? tokenizePii(
              context,
              TOOL,
              'date',
              new Date(surgeryDateRaw).toLocaleDateString('pt-BR'),
            )
          : 'Não agendada';
        const cidLabel = request.cidCode
          ? String(request.cidCode)
          : 'Não informado';
        const registrationLabel = request.healthPlanRegistration
          ? String(request.healthPlanRegistration)
          : 'Não informada';
        const planTypeLabel = request.healthPlanType
          ? String(request.healthPlanType)
          : 'Não informado';

        let pendencyLines: string[] = [];
        if (request.id) {
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
                const undone = (p.checkItems || []).filter(
                  (item) => !item.done,
                );
                if (!undone.length) return [`• ${p.name}`];
                return [
                  `• ${p.name}`,
                  ...undone.map((item) => `  - ${item.label}`),
                ];
              });
              pendencyLines = ['Para avançar de etapa, faça:', ...actions];
            }
          } catch (err) {
            logger.warn(
              `[QUERY_SC] falha ao calcular pendências sc=${request.id}: ${(err as Error)?.message}`,
            );
            pendencyLines = [
              'Próximo passo: consulte as pendências para avançar a etapa.',
            ];
          }
        }

        return [
          `*Solicitação ${protocolDisplay}*`,
          `Status: ${statusLabel}`,
          `Prioridade: ${priority}`,
          `Paciente: ${patientLabel}`,
          `Hospital: ${hospitalLabel}`,
          `Convênio: ${healthPlanLabel}`,
          `Matrícula: ${registrationLabel}`,
          `Plano/Apartamento: ${planTypeLabel}`,
          `CID: ${cidLabel}`,
          `Data da cirurgia: ${surgeryDateToken}`,
          ...pendencyLines,
        ].join('\n');
      }

      const requestedLimit = Number.isFinite(Number(args.limit))
        ? Number(args.limit)
        : 50;
      const limit = Math.min(Math.max(requestedLimit, 1), 200);
      const statusFilter = args.status
        ? STATUS_FILTER[String(args.status).toLowerCase()]
        : undefined;

      if (!context.accessibleDoctorIds.length) {
        return 'Nenhum médico acessível encontrado.';
      }

      const where: FindOptionsWhere<SurgeryRequest> = {
        doctorId: In(context.accessibleDoctorIds),
      };
      if (statusFilter) where.status = statusFilter;

      const requests = await surgeryRequestRepo.findMany(where, 0, limit);

      if (!requests.length) {
        return args.status
          ? `Nenhuma solicitação com status "${args.status}" encontrada.`
          : 'Nenhuma solicitação encontrada.';
      }

      const TOOL = 'query_surgery_requests';
      const groups = new Map<number, SurgeryRequest[]>();
      for (const request of requests) {
        const status = Number(request?.status) || 0;
        const bucket = groups.get(status) ?? [];
        bucket.push(request);
        groups.set(status, bucket);
      }
      for (const items of groups.values()) {
        items.sort((a, b) => {
          const da = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db - da;
        });
      }

      const sections: string[] = [];
      for (const statusCode of ORDERED_STATUSES) {
        const items = groups.get(statusCode);
        if (!items?.length) continue;
        const label = getStatusLabel(statusCode);
        const itemLines = items.map((r) => {
          const protocolToken = tokenizePii(
            context,
            TOOL,
            'protocol',
            stripScPrefix(r.protocol),
          );
          const patientName = r.patient?.name
            ? String(r.patient.name)
            : 'Paciente';
          return `SC-${protocolToken} — ${patientName}`;
        });
        sections.push(`*${label}*\n${itemLines.join('\n')}`);
      }

      return `*Suas solicitações por status:*\n\n${sections.join('\n\n')}`;
    },
  };

  return [querySurgeryRequests];
}
