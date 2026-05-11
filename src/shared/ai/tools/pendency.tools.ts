import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { In } from 'typeorm';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { buildProtocolCandidates, stripScPrefix } from './protocol.helpers';
import {
  PENDENCIES_CONFIG,
  getPendenciesForStatus,
} from '../../../config/pendencies.config';
import { POST_SURGERY_REQUIRED_DOCS } from '../../../config/post-surgery-documents.config';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';

function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

function mapPendencyToRecommendedAction(key: string): {
  action: string;
  minParams: string[];
} {
  switch (key) {
    case 'patient_data':
      return {
        action: 'update_patient_data',
        minParams: ['surgeryRequestId', 'name|cpf|phone|birthDate'],
      };
    case 'hospital_data':
      return {
        action: 'set_hospital',
        minParams: ['surgeryRequestId', 'hospital_name'],
      };
    case 'tuss_procedures':
      return {
        action: 'add_tuss_item',
        minParams: ['surgeryRequestId', 'tussCode', 'name'],
      };
    case 'opme_items':
      return {
        action: 'set_has_opme ou add_opme_item',
        minParams: ['surgeryRequestId', 'hasOpme=true|false'],
      };
    case 'medical_report':
      return {
        action: 'manage_report_sections',
        minParams: ['surgeryRequestId', 'operation=create', 'title'],
      };
    case 'schedule_dates':
      return {
        action: 'update_date_options',
        minParams: ['surgeryRequestId', 'dateOptions[]'],
      };
    case 'confirm_date':
      return {
        action: 'confirm_date',
        minParams: ['surgeryRequestId', 'selectedDateIndex'],
      };
    case 'confirm_receipt':
      return {
        action: 'confirm_receipt',
        minParams: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
      };
    default:
      if (key.startsWith('doc_')) {
        return {
          action: 'attach_document_from_whatsapp',
          minParams: ['surgeryRequestId', 'document_type?', 'confirm=true'],
        };
      }
      return {
        action: 'get_pendencies',
        minParams: ['surgeryRequestId'],
      };
  }
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

  if (identifier.match(/^[0-9a-f-]{36}$/i)) {
    request = await surgeryRequestRepo.findOneSimple({ id: identifier });
    if (request) return request;
  }

  for (const candidate of buildProtocolCandidates(identifier)) {
    request = await surgeryRequestRepo.findOneSimple({ protocol: candidate });
    if (request) return request;
  }

  const byName = await surgeryRequestRepo.findMany(
    { doctorId: In(context.accessibleDoctorIds) as any },
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
  documentRepo: DocumentRepository,
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
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const identifier =
        sanitizeIdentifier(
          detokenizeArg(context, args.surgeryRequestId) ??
            args.surgeryRequestId,
        ) ||
        sanitizeIdentifier(
          detokenizeArg(context, args.identifier) ?? args.identifier,
        );
      if (!identifier) return 'Parâmetro inválido: informe a solicitação.';

      const request = await resolveRequestByIdentifier(
        surgeryRequestRepo,
        identifier,
        context,
      );

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const result = await pendencyValidator.validateForStatus(request.id);
      // Vault armazena o protocol SEM prefixo "SC-"; a string da tool prefixa
      // explicitamente para que o LLM copie o padrão "SC-{{protocol_n}}"
      // (evita o bug de duplicação "SC-SC-XXXXXX" quando a IA também
      // adiciona "SC-" antes do placeholder na resposta final).
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
        `Solicitação ${protocolDisplay} — ${result.statusLabel}`,
        `Status atual: ${result.statusLabel}`,
        'Para avançar, faça:',
        ...pendingLines,
      ];

      return lines.join('\n');
    },
  };

  // Mapa stage → status fonte de verdade.
  // "create"   → o que precisa ANTES da SC nascer (não está no PENDENCIES_CONFIG
  //              porque PENDING é o estado pós-criação; é apenas o mínimo do
  //              wizard de criação para PERSISTIR a SC).
  // "send"     → pendências bloqueantes do status PENDING (passar para Enviada).
  // "schedule" → pendências do IN_SCHEDULING.
  // "invoice"  → pendências do INVOICED.
  // "all"      → todos os status com pendências configuradas.
  const STAGE_LABEL: Record<string, string> = {
    create: 'Criar uma nova SC',
    send: 'Enviar a SC (Pendente → Enviada)',
    schedule: 'Agendar (Em Agendamento → Agendada)',
    invoice: 'Confirmar recebimento (Faturada → Finalizada)',
  };

  const STAGE_TO_STATUS: Record<string, SurgeryRequestStatus | null> = {
    create: null, // tratado à parte
    send: SurgeryRequestStatus.PENDING,
    schedule: SurgeryRequestStatus.IN_SCHEDULING,
    invoice: SurgeryRequestStatus.INVOICED,
  };

  function buildCreationRequirementsBlock(context: ToolContext): string[] {
    const accessibleCount = context.accessibleDoctorIds?.length ?? 0;
    const lines: string[] = [
      `*${STAGE_LABEL.create}*`,
      'Mínimo absoluto para registrar a SC no sistema (status inicial: Pendente):',
      '- Paciente (já cadastrado ou criado na hora com create_patient).',
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
          `- ${p.label}: dados completos do paciente + ao menos 1 seção de laudo + assinatura do médico configurada (responsável: ${p.responsibleRole}).`,
        );
      } else if (p.key === 'patient_data') {
        lines.push(
          `- ${p.label}: nome, data de nascimento, CPF, telefone, endereço e CEP (responsável: ${p.responsibleRole}).`,
        );
      } else {
        lines.push(`- ${p.label} (responsável: ${p.responsibleRole}).`);
      }
    }
    return lines;
  }

  const getWorkflowRequirements: AiTool = {
    name: 'get_workflow_requirements',
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
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
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
    },
  };

  // ────────────────────────────────────────────────────────────────────────
  // list_post_surgery_required_docs
  //
  // Lista os documentos pós-cirúrgicos esperados antes de marcar uma SC
  // como Realizada (transição SCHEDULED → PERFORMED). Para cada documento
  // esperado, verifica se já está anexado à SC.
  //
  // Fonte de verdade: `config/post-surgery-documents.config.ts`. O endpoint
  // `/mark-performed` hoje não bloqueia rigidamente na ausência desses
  // documentos, mas operacionalmente eles são esperados — esta tool
  // existe para que a IA possa orientar proativamente o usuário em vez
  // de chamar `mark_performed` direto.
  // ────────────────────────────────────────────────────────────────────────
  const listPostSurgeryRequiredDocs: AiTool = {
    name: 'list_post_surgery_required_docs',
    definition: {
      type: 'function',
      function: {
        name: 'list_post_surgery_required_docs',
        description:
          'Lista os documentos pós-cirúrgicos esperados antes de marcar uma SC como Realizada (mark_performed) e mostra, para cada um, se já está anexado à SC. Use SEMPRE antes de chamar mark_performed para confirmar que o pacote pós-cirúrgico está completo. Aceita ID UUID, protocolo (SC-XXXX ou XXXX) ou nome do paciente.',
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
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const identifier =
        sanitizeIdentifier(
          detokenizeArg(context, args.surgeryRequestId) ??
            args.surgeryRequestId,
        ) ||
        sanitizeIdentifier(
          detokenizeArg(context, args.identifier) ?? args.identifier,
        );
      if (!identifier) return 'Parâmetro inválido: informe a solicitação.';

      const request = await resolveRequestByIdentifier(
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
      } as any);
      const attachedTypes = new Set(
        (attached || []).map((d: any) => d?.type).filter(Boolean),
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
          'Todos os documentos obrigatórios já estão anexados — pode prosseguir com `mark_performed` informando a data da cirurgia.',
        );
        if (missingOptional > 0) {
          lines.push(
            'Há documentos opcionais ainda não anexados; se tiver, anexe pelo `manage_documents` antes para o registro ficar mais completo.',
          );
        }
      } else {
        lines.push(
          `Faltam ${missingRequired} documento(s) obrigatório(s). Peça para o usuário enviar os arquivos pelo WhatsApp e use \`manage_documents\` (operation=attach, type=<tipo do documento>) para registrar antes de chamar \`mark_performed\`.`,
        );
      }

      return lines.join('\n');
    },
  };

  return [getPendencies, getWorkflowRequirements, listPostSurgeryRequiredDocs];
}
