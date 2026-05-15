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

/**
 * Mapeia uma pendência para a ação recomendada que a IA deve sugerir.
 *
 * Para pendências compostas (ex.: `medical_report`, `opme_items`), a
 * recomendação é DINÂMICA: depende de quais sub-itens (`undoneItems`) ainda
 * estão pendentes. Isso evita recomendar "criar seção do laudo" quando o
 * único sub-item faltando é "Assinatura do médico configurada".
 */
function mapPendencyToRecommendedAction(
  key: string,
  undoneItems: Array<{ label: string; done: boolean }> = [],
): {
  action: string;
  minParams: string[];
} {
  const undoneLabels = new Set(
    undoneItems.map((i) => i.label.toLowerCase().trim()),
  );

  switch (key) {
    case 'patient_data':
      return {
        action:
          'plan_actions(intent="update_sc") + update_sc_draft_set_request + update_sc_draft_set_scope(scope="patient") + update_sc_draft_set_field + update_sc_draft_commit',
        minParams: ['surgery_request_id_or_protocol', 'field', 'value'],
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
    case 'opme_items': {
      // Se o único sub-item pendente é "indicar se há OPME", recomende
      // `set_has_opme`. Caso contrário (já indicou que tem OPME mas falta
      // cadastrar item), recomende `add_opme_item`.
      const onlyMissingFlag =
        undoneLabels.size === 1 &&
        Array.from(undoneLabels).some((l) =>
          l.includes('indicar se há ou não opme'),
        );
      if (onlyMissingFlag) {
        return {
          action: 'set_has_opme',
          minParams: ['surgeryRequestId', 'hasOpme=true|false'],
        };
      }
      return {
        action: 'add_opme_item (ou set_has_opme=false)',
        minParams: [
          'surgeryRequestId',
          'opme_name',
          'quantity',
          'supplier_name?',
        ],
      };
    }
    case 'medical_report': {
      // Recomendação dinâmica: depende do que está faltando dentro do
      // pacote do laudo (paciente, seções OU assinatura).
      const missingSignature = Array.from(undoneLabels).some((l) =>
        l.includes('assinatura'),
      );
      const missingSections = Array.from(undoneLabels).some((l) =>
        l.includes('seção de laudo'),
      );
      const missingPatient = Array.from(undoneLabels).some((l) =>
        [
          'nome do paciente',
          'data de nascimento',
          'cpf',
          'telefone',
          'endereço',
          'cep',
        ].includes(l),
      );

      // Quando só falta a assinatura, oriente direto para
      // `upload_doctor_signature` — esse era o caso mais comum em que a
      // IA recomendava erradamente "criar seção do laudo".
      if (missingSignature && !missingSections && !missingPatient) {
        return {
          action: 'upload_doctor_signature',
          minParams: [
            'imagem da assinatura enviada pelo WhatsApp do MÉDICO',
            'confirm=true',
          ],
        };
      }
      if (missingSections && !missingSignature && !missingPatient) {
        return {
          action: 'manage_report_sections',
          minParams: ['surgeryRequestId', 'operation=create', 'title'],
        };
      }
      if (missingPatient && !missingSections && !missingSignature) {
        return {
          action:
            'plan_actions(intent="update_sc") + update_sc_draft_set_request + update_sc_draft_set_scope(scope="patient") + update_sc_draft_set_field + update_sc_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'field', 'value'],
        };
      }
      // Caso geral (mais de um sub-item faltando): liste tudo que se
      // aplica para a IA orientar passo a passo.
      const actions: string[] = [];
      if (missingPatient) {
        actions.push('completar dados do paciente via update_sc_draft_*');
      }
      if (missingSections) actions.push('manage_report_sections');
      if (missingSignature) actions.push('upload_doctor_signature');
      return {
        action:
          actions.length > 0 ? actions.join(' + ') : 'manage_report_sections',
        minParams: ['surgeryRequestId', 'ver sub-itens pendentes acima'],
      };
    }
    case 'schedule_dates':
      return {
        action:
          'plan_actions(intent="scheduling") + scheduling_draft_set_request + scheduling_draft_set_date_options + scheduling_draft_commit',
        minParams: ['surgery_request_id_or_protocol', 'date_options[]'],
      };
    case 'confirm_date':
      return {
        action:
          'plan_actions(intent="scheduling") + scheduling_draft_set_request + scheduling_draft_set_confirmed_date + scheduling_draft_commit',
        minParams: ['surgery_request_id_or_protocol', 'confirmed_date_index'],
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

/**
 * Mapeia rótulos em PT para o enum `SurgeryRequestStatus`.
 * Normaliza acentos e variações comuns para cobrir o que o LLM pode passar.
 */
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

const STATUS_LABEL: Record<SurgeryRequestStatus, string> = {
  [SurgeryRequestStatus.PENDING]: 'Pendente',
  [SurgeryRequestStatus.SENT]: 'Enviada',
  [SurgeryRequestStatus.IN_ANALYSIS]: 'Em Análise',
  [SurgeryRequestStatus.IN_SCHEDULING]: 'Em Agendamento',
  [SurgeryRequestStatus.SCHEDULED]: 'Agendada',
  [SurgeryRequestStatus.PERFORMED]: 'Realizada',
  [SurgeryRequestStatus.INVOICED]: 'Faturada',
  [SurgeryRequestStatus.FINALIZED]: 'Finalizada',
  [SurgeryRequestStatus.CLOSED]: 'Encerrada',
};

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

      let request: any = null;

      // Se o identifier passado é, na verdade, um rótulo de status (ex.: "pendente",
      // "enviada", "em análise"), trata como statusHint em vez de buscar por protocolo.
      const identifierAsStatus = identifier
        ? resolveStatusFromHint(identifier)
        : null;
      const effectiveIdentifier = identifierAsStatus !== null ? '' : identifier;
      const statusHintOverride =
        identifierAsStatus !== null ? identifierAsStatus : null;

      if (!effectiveIdentifier) {
        // Auto-detecta a SC quando não há identificador explícito.
        // Se `statusHint` for fornecido, filtra pelo status correspondente.
        // Sem hint, busca todas as SCs acessíveis.
        const statusFromHint =
          statusHintOverride ??
          (args.statusHint
            ? resolveStatusFromHint(String(args.statusHint))
            : null);

        const filterWhere: Record<string, any> = {
          doctorId: In(context.accessibleDoctorIds) as any,
        };
        if (statusFromHint !== null) {
          filterWhere.status = statusFromHint;
        }

        // O `findMany` já filtra por `doctorId: In(accessibleDoctorIds)` no
        // WHERE — não precisa filtrar de novo no JS. (Filtrar por `r.doctorId`
        // depois quebrava quando o select do repositório não incluía a coluna
        // — bug 2026-05-14.)
        const accessible =
          (await surgeryRequestRepo.findMany(filterWhere, 0, 20)) || [];

        if (accessible.length === 0) {
          const statusLabel = statusFromHint
            ? ` com status "${STATUS_LABEL[statusFromHint]}"`
            : '';
          return `Nenhuma solicitação cirúrgica${statusLabel} encontrada.`;
        }

        if (accessible.length === 1) {
          request = accessible[0];
        } else {
          // Múltiplas SCs — lista para o LLM apresentar ao usuário
          const statusLabel = statusFromHint
            ? ` com status "${STATUS_LABEL[statusFromHint]}"`
            : '';
          const listing = accessible
            .slice(0, 10)
            .map(
              (r: any) =>
                `SC-${r.protocol} — ${r.patient?.name ?? 'paciente'} (${STATUS_LABEL[r.status as SurgeryRequestStatus] ?? r.status})`,
            )
            .join('\n');
          return [
            `Há ${accessible.length} solicitações${statusLabel}. Informe o protocolo ou nome do paciente:`,
            listing,
          ].join('\n');
        }
      } else {
        request = await resolveRequestByIdentifier(
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

      // Caso especial: única pendência é `medical_report` e o ÚNICO sub-item
      // faltando é a assinatura do médico. Devolve uma mensagem ULTRA-direta
      // que evita o LLM continuar dizendo "completar o laudo médico" /
      // "criar seção do laudo" — só falta a foto da assinatura no WhatsApp
      // do próprio médico.
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
        const recommendation = mapPendencyToRecommendedAction(
          p.key,
          undoneItems,
        );

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
  // existe para que a IA possa orientar proativamente o usuário antes de
  // iniciar o fluxo `plan_actions(intent="mark_performed")` +
  // `mark_performed_draft_*` (que também valida docs no `_check_docs`,
  // `_preview` e `_commit`).
  // ────────────────────────────────────────────────────────────────────────
  const listPostSurgeryRequiredDocs: AiTool = {
    name: 'list_post_surgery_required_docs',
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
          'Todos os documentos obrigatórios já estão anexados — pode prosseguir com `plan_actions(intent="mark_performed")` + `mark_performed_draft_*` informando a data da cirurgia.',
        );
        if (missingOptional > 0) {
          lines.push(
            'Há documentos opcionais ainda não anexados; se tiver, anexe pelo `manage_documents` antes para o registro ficar mais completo.',
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
