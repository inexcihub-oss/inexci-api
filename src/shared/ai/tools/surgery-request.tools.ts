import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';
import { In } from 'typeorm';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { buildProtocolCandidates, stripScPrefix } from './protocol.helpers';

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

async function resolveRequestByIdentifier(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: string,
  context: ToolContext,
): Promise<any | null> {
  const detokenized = detokenizeArg(context, identifierRaw);
  const identifier = sanitizeIdentifier(detokenized ?? identifierRaw);
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
      { doctorId: In(context.accessibleDoctorIds) as any },
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
          'Busca o status e detalhes resumidos de uma solicitação cirúrgica (status, prioridade, paciente, hospital, convênio, CID, matrícula, plano/apartamento, data e pendências). Aceita ID UUID ou número de protocolo (ex: SC-0042) ou nome do paciente.',
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
        return 'Não encontrei essa solicitação. Verifique o número do protocolo ou o nome do paciente e tente novamente.';
      }

      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const status = STATUS_LABELS[request.status] || String(request.status);
      const priority =
        PRIORITY_LABELS[request.priority as any] || String(request.priority);
      const TOOL = 'get_surgery_request_status';
      // Vault armazena o protocol SEM prefixo "SC-"; prefixamos no template
      // (`SC-${protocolToken}`) para evitar duplicação `SC-SC-` quando a IA
      // copia o padrão.
      const protocolToken = tokenizePii(
        context,
        TOOL,
        'protocol',
        stripScPrefix(request.protocol),
      );
      const protocolDisplay = `SC-${protocolToken}`;
      const patientToken = tokenizePii(
        context,
        TOOL,
        'patient_name',
        (request as any).patient?.name || request.patientId,
      );
      const hospitalToken = (request as any).hospital?.name
        ? tokenizePii(
            context,
            TOOL,
            'hospital_name',
            (request as any).hospital.name,
          )
        : 'Não definido';
      const healthPlanToken = (request as any).healthPlan?.name
        ? tokenizePii(
            context,
            TOOL,
            'health_plan_name',
            (request as any).healthPlan.name,
          )
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

      const cidLabel = (request as any).cidCode
        ? String((request as any).cidCode)
        : 'Não informado';
      const registrationLabel = (request as any).healthPlanRegistration
        ? String((request as any).healthPlanRegistration)
        : 'Não informada';
      const planTypeLabel = (request as any).healthPlanType
        ? String((request as any).healthPlanType)
        : 'Não informado';

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
        `*Solicitação ${protocolDisplay}*`,
        `Status: ${status}`,
        `Prioridade: ${priority}`,
        `Paciente: ${patientToken}`,
        `Hospital: ${hospitalToken}`,
        `Convênio: ${healthPlanToken}`,
        `Matrícula: ${registrationLabel}`,
        `Plano/Apartamento: ${planTypeLabel}`,
        `CID: ${cidLabel}`,
        `Data da cirurgia: ${surgeryDateToken}`,
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
          'Lista TODAS as solicitações cirúrgicas acessíveis ao usuário, agrupadas e ordenadas por status (Pendente → Encerrada). Por padrão traz até 200 SCs (todas, na maioria dos casos). Aceita filtro opcional por status.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description:
                'Status para filtrar (opcional): pendente, enviada, em_analise, em_agendamento, agendada, realizada, faturada, finalizada, encerrada',
            },
            limit: {
              type: 'number',
              description:
                'Quantidade máxima de resultados (padrão: 50, máximo: 200). Use o padrão para listagens completas.',
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

      const requestedLimit = Number.isFinite(Number(args.limit))
        ? Number(args.limit)
        : 50;
      const limit = Math.min(Math.max(requestedLimit, 1), 200);
      const statusNum = args.status
        ? STATUS_MAP[String(args.status).toLowerCase()]
        : undefined;

      if (!context.accessibleDoctorIds.length) {
        return 'Nenhum médico acessível encontrado.';
      }

      // BUG histórico: usar `accessibleDoctorIds[0]` escondia SCs de
      // colaboradores com acesso a múltiplos médicos. Listar de TODOS.
      const where: any = { doctorId: In(context.accessibleDoctorIds) as any };
      if (statusNum) where.status = statusNum as SurgeryRequestStatus;

      const requests = await surgeryRequestRepo.findMany(where, 0, limit);

      if (!requests.length) {
        return args.status
          ? `Nenhuma solicitação com status "${args.status}" encontrada.`
          : 'Nenhuma solicitação encontrada.';
      }

      const TOOL = 'list_surgery_requests';

      // Agrupa por status. Iterar depois sobre a ordem CANÔNICA do workflow
      // (1..9) garante "Pendente → Enviada → Em Análise → ..." mesmo que a
      // query tenha trazido os registros embaralhados.
      const groups = new Map<number, any[]>();
      for (const request of requests) {
        const status = Number(request?.status) || 0;
        const bucket = groups.get(status) ?? [];
        bucket.push(request);
        groups.set(status, bucket);
      }

      // Desempate dentro de cada grupo: createdAt mais recente primeiro.
      for (const items of groups.values()) {
        items.sort((a: any, b: any) => {
          const da = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db - da;
        });
      }

      const sections: string[] = [];
      // Ordem fixa do workflow — não depende da ordem de inserção no Map.
      const ORDERED_STATUSES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (const status of ORDERED_STATUSES) {
        const items = groups.get(status);
        if (!items?.length) continue;
        const label = STATUS_LABELS[status] || `Status ${status}`;
        // Sem bullet/numeração: a SC já tem protocolo (SC-XXXX) como
        // identificador natural — qualquer prefixo numérico vira ruído e
        // induz o usuário a responder "1" achando que abre a SC.
        const itemLines = items.map((r: any) => {
          const protocolToken = tokenizePii(
            context,
            TOOL,
            'protocol',
            stripScPrefix(r.protocol),
          );
          const patientToken = r.patient?.name
            ? tokenizePii(context, TOOL, 'patient_name', r.patient.name)
            : 'Paciente';
          return `SC-${protocolToken} — ${patientToken}`;
        });
        sections.push(`*${label}*\n${itemLines.join('\n')}`);
      }

      return `*Suas solicitações por status:*\n\n${sections.join('\n\n')}`;
    },
  };

  return [getSurgeryRequestStatus, listSurgeryRequests];
}
