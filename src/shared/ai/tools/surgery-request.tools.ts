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
  /**
   * `query_surgery_requests` substitui `get_surgery_request_status` +
   * `list_surgery_requests` (removidas em Mai/2026 — Fase 4.2 do
   * PLANO-CONSOLIDACAO-TOOLS-IA-VIA-SERVICES-REST).
   *
   * - Com `identifier` → detalhe completo da SC (status, prioridade,
   *   paciente, hospital, convênio, CID, data, pendências).
   * - Sem `identifier` → lista todas as SCs, opcionalmente filtradas por status.
   *
   * ⚠️ bypass justificado: acessa o repositório diretamente pois a lógica
   * é exclusivamente de leitura e constrói um payload simplificado para o LLM.
   */
  const querySurgeryRequests: AiTool = {
    name: 'query_surgery_requests',
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

      const identifierRaw = (args as any).identifier;

      // ── Detalhe de uma SC específica ────────────────────────────────────────
      if (identifierRaw) {
        const resolvedRequest = await resolveRequestByIdentifier(
          surgeryRequestRepo,
          identifierRaw,
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

        const statusLabel =
          STATUS_LABELS[request.status] || String(request.status);
        const priority =
          PRIORITY_LABELS[request.priority as any] || String(request.priority);
        const TOOL = 'query_surgery_requests';
        // Vault armazena o protocol SEM prefixo "SC-"; prefixamos no template
        // para evitar duplicação "SC-SC-" quando a IA copia o padrão.
        const protocolToken = tokenizePii(
          context,
          TOOL,
          'protocol',
          stripScPrefix(request.protocol),
        );
        const protocolDisplay = `SC-${protocolToken}`;
        // Nomes de paciente/hospital/convênio ficam em claro nas saídas de
        // tools de leitura (PII de negócio do próprio owner_id).
        const patientLabel = String(
          (request as any).patient?.name ||
            request.patientId ||
            'Não informado',
        );
        const hospitalLabel = (request as any).hospital?.name
          ? String((request as any).hospital.name)
          : 'Não definido';
        const healthPlanLabel = (request as any).healthPlan?.name
          ? String((request as any).healthPlan.name)
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
          } catch {
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

      // ── Listagem ────────────────────────────────────────────────────────────
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

      const where: any = { doctorId: In(context.accessibleDoctorIds) as any };
      if (statusNum) where.status = statusNum as SurgeryRequestStatus;

      const requests = await surgeryRequestRepo.findMany(where, 0, limit);

      if (!requests.length) {
        return args.status
          ? `Nenhuma solicitação com status "${args.status}" encontrada.`
          : 'Nenhuma solicitação encontrada.';
      }

      const TOOL = 'query_surgery_requests';
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
      for (const statusCode of ORDERED_STATUSES) {
        const items = groups.get(statusCode);
        if (!items?.length) continue;
        const label = STATUS_LABELS[statusCode] || `Status ${statusCode}`;
        // Sem bullet/numeração: a SC já tem protocolo (SC-XXXX) como
        // identificador natural.
        const itemLines = items.map((r: any) => {
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

  // Tools legacy removidas:
  //  - `get_surgery_request_status` + `list_surgery_requests` (2026-05-12,
  //    Fase 4.2 do PLANO-CONSOLIDACAO-TOOLS-IA-VIA-SERVICES-REST): unificadas
  //    em `query_surgery_requests`.

  return [querySurgeryRequests];
}
