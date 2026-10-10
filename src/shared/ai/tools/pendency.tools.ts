import { AiTool, ToolContext } from './tool.interface';
import { Permission } from 'src/shared/permissions';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { stripScPrefix } from './protocol.helpers';
import { argToString, asScalarArg } from './helpers/arg-parsers';
import {
  PENDENCIES_CONFIG,
  getPendenciesForStatus,
} from '../../../config/pendencies.config';
import { POST_SURGERY_REQUIRED_DOCS } from '../../../config/post-surgery-documents.config';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from '../../../database/entities/surgery-request.entity';
import { getStatusLabel } from '../../utils/status';
import {
  resolveRequestByIdentifierOrPatientName,
  sanitizeIdentifier,
} from './helpers/surgery-request-access';
import { recommendActionForPendency } from './helpers/pendency-actions';

function resolveStatusFromHint(hint: string): SurgeryRequestStatus | null {
  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const n = normalize(hint);
  if (/^pendente/.test(n)) return SurgeryRequestStatus.PENDING;
  if (/^enviada/.test(n)) return SurgeryRequestStatus.SENT;
  if (/analise/.test(n)) return SurgeryRequestStatus.IN_ANALYSIS;
  if (/agendamento/.test(n)) return SurgeryRequestStatus.IN_SCHEDULING;
  if (/^agendada/.test(n)) return SurgeryRequestStatus.SCHEDULED;
  if (/^realizada/.test(n)) return SurgeryRequestStatus.PERFORMED;
  if (/^faturada/.test(n)) return SurgeryRequestStatus.INVOICED;
  if (/^finalizada/.test(n)) return SurgeryRequestStatus.FINALIZED;
  if (/encerrada|fechada|cancelada/.test(n)) return SurgeryRequestStatus.CLOSED;
  return null;
}

export interface PendencyToolDeps {
  pendencyValidator: PendencyValidatorService;
  surgeryRequestRepo: SurgeryRequestRepository;
  documentRepo: DocumentRepository;
}

export function buildPendencyTools({
  pendencyValidator,
  surgeryRequestRepo,
  documentRepo,
}: PendencyToolDeps): AiTool[] {
  const getPendencies: AiTool = {
    name: 'get_pendencies',
    requiredPermission: Permission.SOLICITACOES,
    definition: {
      type: 'function',
      function: {
        name: 'get_pendencies',
        description:
          'Verifica pendências de uma solicitação cirúrgica e explica exatamente o que falta para avançar para a próxima etapa. Aceita ID UUID, protocolo (SC-XXXX ou XXXX) ou nome do paciente. Se nenhum identificador for informado, use `statusHint` com o status mencionado na conversa (ex.: "pendente", "em análise", "agendada") — a tool localiza automaticamente a SC única com aquele status. Se também não houver hint de status e houver exatamente uma SC acessível, ela é usada automaticamente.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'Identificador da solicitação: UUID, protocolo SC-XXXX ou número',
            },
            identifier: {
              type: 'string',
              description:
                'Alias de identificador da solicitação: UUID, protocolo SC-XXXX ou nome do paciente',
            },
            statusHint: {
              type: 'string',
              description:
                'Status mencionado pelo usuário na conversa (ex.: "pendente", "enviada", "em análise", "em agendamento", "agendada", "realizada", "faturada", "finalizada", "encerrada"). Usado para auto-localizar a SC quando não há identificador explícito.',
            },
          },
          required: [],
        },
      },
    },
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const identifier =
        sanitizeIdentifier(
          detokenizeArg(context, asScalarArg(args.surgeryRequestId)) ??
            args.surgeryRequestId,
        ) ||
        sanitizeIdentifier(
          detokenizeArg(context, asScalarArg(args.identifier)) ??
            args.identifier,
        );

      let request: SurgeryRequest | null = null;

      const identifierAsStatus = identifier
        ? resolveStatusFromHint(identifier)
        : null;
      const effectiveIdentifier = identifierAsStatus !== null ? '' : identifier;
      const statusHintOverride =
        identifierAsStatus !== null ? identifierAsStatus : null;

      if (!effectiveIdentifier) {
        const statusFromHint =
          statusHintOverride ??
          (args.statusHint
            ? resolveStatusFromHint(argToString(args.statusHint))
            : null);

        const filterWhere: FindOptionsWhere<SurgeryRequest> = {
          doctorId: In(context.accessibleDoctorIds),
        };
        if (statusFromHint !== null) {
          filterWhere.status = statusFromHint;
        }

        const accessible =
          (await surgeryRequestRepo.findMany(filterWhere, 0, 20)) || [];

        if (accessible.length === 0) {
          const statusLabel = statusFromHint
            ? ` com status "${getStatusLabel(statusFromHint)}"`
            : '';
          return `Nenhuma solicitação cirúrgica${statusLabel} encontrada.`;
        }

        if (accessible.length === 1) {
          request = accessible[0];
        } else {
          const statusLabel = statusFromHint
            ? ` com status "${getStatusLabel(statusFromHint)}"`
            : '';
          const listing = accessible
            .slice(0, 10)
            .map(
              (r) =>
                `SC-${r.protocol} — ${r.patient?.name ?? 'paciente'} (${getStatusLabel(r.status)})`,
            )
            .join('\n');
          return [
            `Há ${accessible.length} solicitações${statusLabel}. Informe o protocolo ou nome do paciente:`,
            listing,
          ].join('\n');
        }
      } else {
        request = await resolveRequestByIdentifierOrPatientName(
          surgeryRequestRepo,
          effectiveIdentifier,
          context,
        );
      }

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const result = await pendencyValidator.validateForStatus(request.id);
      const protocolToken = tokenizePii(
        context,
        'get_pendencies',
        'protocol',
        stripScPrefix(request.protocol),
      );
      const protocolDisplay = `SC-${protocolToken}`;

      if (!result.pendencies.length) {
        return `A solicitação ${protocolDisplay} não tem pendências no status atual. Ela pode avançar para a próxima etapa.`;
      }

      const pending = result.pendencies.filter(
        (p) => !p.isComplete && !p.isOptional,
      );

      if (!pending.length) {
        return `A solicitação ${protocolDisplay} não possui pendências bloqueantes no status ${result.statusLabel}. Pode avançar para a próxima etapa.`;
      }

      if (pending.length === 1 && pending[0].key === 'medical_report') {
        const undone = (pending[0].checkItems || []).filter((i) => !i.done);
        const onlySignature =
          undone.length === 1 &&
          undone[0].label.toLowerCase().includes('assinatura');
        if (onlySignature) {
          return [
            `Solicitação ${protocolDisplay} — ${result.statusLabel}`,
            'PENDÊNCIA ÚNICA: falta APENAS a assinatura digital do médico.',
            'O laudo já tem todos os dados do paciente preenchidos e pelo menos uma seção criada — NÃO sugira "criar seção do laudo" nem "completar laudo médico".',
            'Ação recomendada agora: peça ao MÉDICO responsável que envie a foto da assinatura aqui no WhatsApp DELE e chame `upload_doctor_signature` (a tool aceita a foto da mensagem atual ou de turnos recentes via staging).',
            'Se o usuário atual já é o próprio médico (tem doctor_profile), ele mesmo pode mandar a foto e a tool resolve.',
          ].join('\n');
        }
      }

      const pendingLines = pending.flatMap((p) => {
        const undoneItems = (p.checkItems || []).filter((i) => !i.done);
        const recommendation = recommendActionForPendency(p.key, undoneItems);

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
        `Solicitação ${protocolDisplay} — ${result.statusLabel}`,
        `Status atual: ${result.statusLabel}`,
        'Para avançar, faça:',
        ...pendingLines,
      ];

      return lines.join('\n');
    },
  };

  const STAGE_LABEL: Record<string, string> = {
    create: 'Criar uma nova SC',
    send: 'Enviar a SC (Pendente → Enviada)',
    schedule: 'Agendar (Em Agendamento → Agendada)',
    invoice: 'Confirmar recebimento (Faturada → Finalizada)',
  };

  const STAGE_TO_STATUS: Record<string, SurgeryRequestStatus | null> = {
    create: null,
    send: SurgeryRequestStatus.PENDING,
    schedule: SurgeryRequestStatus.IN_SCHEDULING,
    invoice: SurgeryRequestStatus.INVOICED,
  };

  function buildCreationRequirementsBlock(context: ToolContext): string[] {
    const accessibleCount = context.accessibleDoctorIds?.length ?? 0;
    const lines: string[] = [
      `*${STAGE_LABEL.create}*`,
      'Mínimo absoluto para registrar a SC no sistema (status inicial: Pendente):',
      '- Paciente (já cadastrado ou criado na hora pelo fluxo `plan_actions(intent="create_patient")` + `patient_draft_*`).',
      '- Procedimento (escolhido do catálogo da clínica).',
      '- Prioridade (Baixa, Média, Alta ou Urgente).',
    ];
    if (accessibleCount > 1) {
      lines.push(
        '- Médico responsável (você tem acesso a mais de um — precisa indicar qual é o dono da SC).',
      );
    } else {
      lines.push(
        '- Médico responsável (já é assumido automaticamente quando você só tem acesso a um).',
      );
    }
    lines.push('Opcionais já na criação (podem entrar depois):');
    lines.push('- Hospital (opcional na criação; obrigatório para enviar).');
    lines.push('- Convênio (opcional em todo o fluxo).');
    lines.push(
      'Importante: TUSS, OPME e laudo NÃO são exigidos para criar — só para ENVIAR. Use stage="send" para ver os requisitos de envio.',
    );
    return lines;
  }

  function buildStatusPendenciesBlock(
    status: SurgeryRequestStatus,
    stageLabel: string,
  ): string[] {
    const config = getPendenciesForStatus(status);
    const lines: string[] = [`*${stageLabel}*`];
    if (!config || config.pendencies.length === 0) {
      lines.push('Nenhum requisito formal nesta etapa.');
      return lines;
    }
    lines.push('Requisitos bloqueantes (todos precisam estar concluídos):');
    for (const p of config.pendencies) {
      if (p.key === 'opme_items') {
        lines.push(
          `- ${p.label}: ou marcar que NÃO há OPME nesta SC, ou cadastrar ao menos 1 item OPME (responsável: ${p.responsibleRole}).`,
        );
      } else if (p.key === 'medical_report') {
        lines.push(
          `- ${p.label}: nome e CPF do paciente + ao menos 1 seção de laudo + assinatura do médico configurada (responsável: ${p.responsibleRole}).`,
        );
      } else if (p.key === 'patient_data') {
        lines.push(
          `- ${p.label}: nome e CPF (responsável: ${p.responsibleRole}).`,
        );
      } else {
        lines.push(`- ${p.label} (responsável: ${p.responsibleRole}).`);
      }
    }
    return lines;
  }

  const runGetWorkflowRequirements = (
    args: Record<string, unknown>,
    context: ToolContext,
  ): string => {
    if (!context.userId) return 'Acesso negado.';

    const stageRaw =
      typeof args?.stage === 'string'
        ? args.stage.trim().toLowerCase()
        : 'create';
    const stage = ['create', 'send', 'schedule', 'invoice', 'all'].includes(
      stageRaw,
    )
      ? stageRaw
      : 'create';

    if (stage === 'create') {
      return buildCreationRequirementsBlock(context).join('\n');
    }

    if (stage === 'all') {
      const blocks: string[] = [];
      blocks.push(buildCreationRequirementsBlock(context).join('\n'));
      for (const cfg of PENDENCIES_CONFIG) {
        if (!cfg.pendencies.length) continue;
        blocks.push(
          buildStatusPendenciesBlock(
            cfg.status,
            `Etapa: ${cfg.label} → próxima`,
          ).join('\n'),
        );
      }
      return blocks.join('\n\n');
    }

    const status = STAGE_TO_STATUS[stage];
    if (status === null || status === undefined) {
      return 'Parâmetro inválido: `stage` deve ser create, send, schedule, invoice ou all.';
    }
    return buildStatusPendenciesBlock(status, STAGE_LABEL[stage]).join('\n');
  };

  const getWorkflowRequirements: AiTool = {
    name: 'get_workflow_requirements',
    requiredPermission: Permission.SOLICITACOES,
    definition: {
      type: 'function',
      function: {
        name: 'get_workflow_requirements',
        description:
          'Lista os requisitos REAIS de cada etapa do fluxo de uma solicitação cirúrgica (fonte de verdade). Use SEMPRE que o usuário perguntar "o que precisa para criar/enviar/agendar uma SC?" — NÃO invente os requisitos. Por padrão devolve os requisitos para CRIAR; use `stage` para outras etapas.',
        parameters: {
          type: 'object',
          properties: {
            stage: {
              type: 'string',
              enum: ['create', 'send', 'schedule', 'invoice', 'all'],
              description:
                'Etapa do fluxo: create=criar a SC; send=enviar (Pendente→Enviada); schedule=agendar; invoice=confirmar recebimento; all=todas as etapas. Default: create.',
            },
          },
          required: [],
        },
      },
    },
    execute(args, context: ToolContext): Promise<string> {
      return new Promise<string>((resolve) =>
        resolve(runGetWorkflowRequirements(args, context)),
      );
    },
  };

  const listPostSurgeryRequiredDocs: AiTool = {
    name: 'list_post_surgery_required_docs',
    requiredPermission: Permission.SOLICITACOES,
    definition: {
      type: 'function',
      function: {
        name: 'list_post_surgery_required_docs',
        description:
          'Lista os documentos pós-cirúrgicos esperados antes de marcar uma SC como Realizada (intent "mark_performed") e mostra, para cada um, se já está anexado à SC. Use SEMPRE antes de iniciar `plan_actions(intent="mark_performed")` para confirmar que o pacote pós-cirúrgico está completo. Aceita ID UUID, protocolo (SC-XXXX ou XXXX) ou nome do paciente.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'Identificador da SC: UUID, protocolo SC-XXXX ou número.',
            },
            identifier: {
              type: 'string',
              description:
                'Alias de identificador da SC: UUID, protocolo SC-XXXX ou nome do paciente.',
            },
          },
          required: [],
        },
      },
    },
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const identifier =
        sanitizeIdentifier(
          detokenizeArg(context, asScalarArg(args.surgeryRequestId)) ??
            args.surgeryRequestId,
        ) ||
        sanitizeIdentifier(
          detokenizeArg(context, asScalarArg(args.identifier)) ??
            args.identifier,
        );
      if (!identifier) return 'Parâmetro inválido: informe a solicitação.';

      const request = await resolveRequestByIdentifierOrPatientName(
        surgeryRequestRepo,
        identifier,
        context,
      );
      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const TOOL = 'list_post_surgery_required_docs';
      const protocolToken = tokenizePii(
        context,
        TOOL,
        'protocol',
        stripScPrefix(request.protocol),
      );
      const protocolDisplay = `SC-${protocolToken}`;

      const attached = await documentRepo.findMany({
        surgeryRequestId: request.id,
      });
      const attachedTypes = new Set(
        (attached || []).map((d) => d?.type).filter(Boolean),
      );

      const lines: string[] = [
        `Documentos pós-cirúrgicos esperados para ${protocolDisplay}:`,
        '',
      ];

      let missingRequired = 0;
      let missingOptional = 0;

      for (const doc of POST_SURGERY_REQUIRED_DOCS) {
        const present = attachedTypes.has(doc.type);
        const tag = doc.required ? 'obrigatório' : 'opcional';
        const statusLine = present
          ? `[anexado] ${doc.label} (${tag})`
          : `[faltando] ${doc.label} (${tag})`;
        if (!present) {
          if (doc.required) missingRequired++;
          else missingOptional++;
        }
        lines.push(statusLine);
        lines.push(`   ${doc.hint}`);
      }

      lines.push('');

      if (missingRequired === 0) {
        lines.push(
          'Nenhum documento pós-cirúrgico é obrigatório para marcar como realizada — pode prosseguir com `plan_actions(intent="mark_performed")` + `mark_performed_draft_*` informando a data da cirurgia.',
        );
        if (missingOptional > 0) {
          lines.push(
            'Há documentos recomendados ainda não anexados; se tiver, anexe pelo `manage_documents` para compor o pacote de faturamento.',
          );
        }
      } else {
        lines.push(
          `Faltam ${missingRequired} documento(s) obrigatório(s). Peça para o usuário enviar os arquivos pelo WhatsApp e use \`manage_documents\` (operation=attach, type=<tipo do documento>) para registrar antes de iniciar \`plan_actions(intent="mark_performed")\`.`,
        );
      }

      return lines.join('\n');
    },
  };

  return [getPendencies, getWorkflowRequirements, listPostSurgeryRequiredDocs];
}
