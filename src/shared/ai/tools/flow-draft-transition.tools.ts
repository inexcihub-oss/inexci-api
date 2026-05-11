import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';
import { SendMethod } from '../../constants/send-method';
import {
  POST_SURGERY_REQUIRED_DOCS,
  PostSurgeryRequiredDoc,
} from '../../../config/post-surgery-documents.config';
import { resolveAuthorizedRequest } from './action.tools';
import { detokenizeArg } from '../pii/tool-pii-helpers';
import { buildToolResult } from './tool-result';
import {
  AcceptAuthorizationDraftFields,
  MarkPerformedDraftFields,
  OperationDraftType,
  SendScDraftFields,
  StartAnalysisDraftFields,
} from '../drafts/operation-draft.types';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

interface FlowDraftTransitionDeps {
  draftService: OperationDraftService;
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: SurgeryRequestWorkflowService;
  activityRepo: SurgeryRequestActivityRepository;
  documentRepo: DocumentRepository;
  pendencyValidator: PendencyValidatorService;
}

function asText(context: ToolContext, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const v = detokenizeArg(context, raw as any);
  const t = String(v ?? '').trim();
  return t || null;
}

function asIsoDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!ISO_DATE_REGEX.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

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

/**
 * Tools de transição com draft (Fase 6.5) que cobrem as transições "ricas"
 * onde o frontend abre um modal exigindo campos obrigatórios antes de mudar
 * o status. Cada draft preserva o que foi coletado entre turnos e bloqueia
 * o commit até estar completo:
 *
 *  - `send_sc_draft_*`              — PENDING → SENT (método de envio, destinatário/email)
 *  - `start_analysis_draft_*`       — SENT → IN_ANALYSIS (nº da operadora, data, cotações)
 *  - `accept_authorization_draft_*` — IN_ANALYSIS → IN_SCHEDULING (datas propostas)
 *  - `mark_performed_draft_*`       — SCHEDULED → PERFORMED (data + documentos cirúrgicos)
 */
export function buildFlowDraftTransitionTools(
  deps: FlowDraftTransitionDeps,
): AiTool[] {
  const {
    draftService,
    surgeryRequestRepo,
    workflowService,
    activityRepo,
    documentRepo,
    pendencyValidator,
  } = deps;

  async function guardDraft(
    context: ToolContext,
    type: OperationDraftType,
  ): Promise<string | null> {
    const current = await draftService.getCurrent(context.conversationId);
    if (!current) {
      return buildToolResult({
        status: 'blocked',
        message: `Não há rascunho de "${type}" ativo. Chame \`plan_actions\` com intent="${type}" primeiro.`,
      });
    }
    if (current.type !== type) {
      return buildToolResult({
        status: 'blocked',
        message: `O rascunho ativo é do tipo "${current.type}", não "${type}". Conclua ou cancele antes.`,
      });
    }
    return null;
  }

  /**
   * Valida que a SC apontada pelo draft está no status esperado para a
   * transição. Retorna `null` se ok ou um payload `blocked` se a SC já
   * mudou de status ou não pode receber essa transição.
   */
  async function assertCurrentStatusIs(
    surgeryRequestId: string,
    expected: SurgeryRequestStatus,
  ): Promise<string | null> {
    const sc = await surgeryRequestRepo.findOneSimple({ id: surgeryRequestId });
    if (!sc) {
      return buildToolResult({
        status: 'error',
        message: 'Solicitação não encontrada.',
      });
    }
    if (sc.status !== expected) {
      return buildToolResult({
        status: 'blocked',
        message: `A solicitação ${sc.protocol ?? sc.id} está no status "${STATUS_LABELS[sc.status] ?? sc.status}", não em "${STATUS_LABELS[expected]}". Essa transição não é mais válida.`,
      });
    }
    return null;
  }

  async function setSurgeryRequestField<T extends OperationDraftType>(
    context: ToolContext,
    type: T,
    rawIdentifier: unknown,
  ): Promise<string> {
    const auth = await resolveAuthorizedRequest(
      surgeryRequestRepo,
      rawIdentifier,
      context,
    );
    if (!auth.request) {
      return buildToolResult({
        status: 'error',
        message: auth.error ?? 'Solicitação não encontrada.',
      });
    }
    await draftService.setFields(context.conversationId, type, {
      surgeryRequestId: auth.request.id,
      surgeryRequestLabel: auth.request.protocol,
    } as any);
    return buildToolResult({
      status: 'ok',
      data: {
        surgeryRequestId: auth.request.id,
        surgeryRequestLabel: auth.request.protocol,
      },
    });
  }

  /* ============================================================
   * SEND SC (PENDING → SENT)
   * ============================================================ */

  const sendScSetRequest: AiTool = {
    name: 'send_sc_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_set_request',
        description:
          'Define a solicitação cirúrgica que será enviada para análise. Aceita UUID, SC-XXXX ou apenas o número.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'send_sc');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'send_sc',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const sendScSetMethod: AiTool = {
    name: 'send_sc_draft_set_method',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_set_method',
        description:
          'Define o método de envio: "email" (envia para destinatários por e-mail) ou "download" (baixa PDF para envio manual).',
        parameters: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['email', 'download'] },
          },
          required: ['method'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'send_sc');
      if (blocked) return blocked;
      const method = String(args.method ?? '').toLowerCase();
      if (method !== 'email' && method !== 'download') {
        return buildToolResult({
          status: 'error',
          message: '`method` deve ser "email" ou "download".',
        });
      }
      await draftService.setFields(context.conversationId, 'send_sc', {
        method: method as 'email' | 'download',
      } satisfies Partial<SendScDraftFields>);
      return buildToolResult({ status: 'ok', data: { method } });
    },
  };

  const sendScSetEmailFields: AiTool = {
    name: 'send_sc_draft_set_email_fields',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_set_email_fields',
        description:
          'Define destinatários (`to`, separados por `;`), assunto e mensagem opcional para envio por e-mail. Use apenas se `method` for "email".',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'E-mails separados por ;' },
            subject: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'send_sc');
      if (blocked) return blocked;
      const patch: Partial<SendScDraftFields> = {};
      if (args.to !== undefined) {
        const v = asText(context, args.to);
        if (!v) {
          return buildToolResult({
            status: 'error',
            message: '`to` não pode ser vazio.',
          });
        }
        patch.to = v;
      }
      if (args.subject !== undefined) {
        const v = asText(context, args.subject);
        if (!v) {
          return buildToolResult({
            status: 'error',
            message: '`subject` não pode ser vazio.',
          });
        }
        patch.subject = v;
      }
      if (args.message !== undefined) {
        const v = asText(context, args.message);
        patch.message = v ?? '';
      }
      if (!Object.keys(patch).length) {
        return buildToolResult({
          status: 'error',
          message: 'Nenhum campo informado.',
        });
      }
      await draftService.setFields(context.conversationId, 'send_sc', patch);
      return buildToolResult({ status: 'ok', data: patch });
    },
  };

  const sendScPreview: AiTool = {
    name: 'send_sc_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_preview',
        description:
          'Gera o preview do envio (status checklist + método). Valida pendências bloqueantes (TUSS, OPME, laudo, hospital) antes de aceitar.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(context.conversationId, 'send_sc');
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de envio ativo.',
        });
      }

      const fields = v.draft.fields;
      const requiresEmailFields = fields.method === 'email';
      const missing = [...v.missing];
      if (requiresEmailFields) {
        if (!fields.to || !fields.to.trim()) missing.push('to');
        if (!fields.subject || !fields.subject.trim()) missing.push('subject');
      }
      if (missing.length) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${missing.join(', ')}.`,
          nextRequiredFields: missing,
        });
      }

      if (fields.surgeryRequestId) {
        const summary = await pendencyValidator.getSummary(
          fields.surgeryRequestId,
        );
        if (!summary.canAdvance) {
          const blockingPendencies = summary.items
            .filter((p) => p.blocking && !p.resolved)
            .map((p) => `• ${p.label}`)
            .join('\n');
          return buildToolResult({
            status: 'blocked',
            message: `A solicitação ainda tem pendências bloqueantes que precisam ser resolvidas antes do envio:\n${blockingPendencies}`,
          });
        }
      }

      const { text } = await draftService.getPreview(
        context.conversationId,
        'send_sc',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const sendScCommit: AiTool = {
    name: 'send_sc_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_commit',
        description:
          'Envia a SC para análise após confirmação (`confirm=true`). Avança status PENDING → SENT.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para enviar a solicitação, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(context.conversationId, 'send_sc');
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de envio ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const statusError = await assertCurrentStatusIs(
        f.surgeryRequestId!,
        SurgeryRequestStatus.PENDING,
      );
      if (statusError) return statusError;

      try {
        await workflowService.sendRequest(
          f.surgeryRequestId!,
          {
            method:
              f.method === 'email' ? SendMethod.EMAIL : SendMethod.DOWNLOAD,
            to: f.to,
            subject: f.subject,
            message: f.message,
            notifyPatient: f.notifyPatient,
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação enviada para análise via draft (${f.method}).`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId} enviada para análise com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao enviar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const sendScCancel: AiTool = {
    name: 'send_sc_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_cancel',
        description: 'Cancela o rascunho de envio.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de envio cancelado.',
      });
    },
  };

  const sendScStatus: AiTool = {
    name: 'send_sc_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_status',
        description: 'Mostra o estado do rascunho de envio.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(context.conversationId, 'send_sc');
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de envio ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  /* ============================================================
   * START ANALYSIS (SENT → IN_ANALYSIS)
   * ============================================================ */

  const startAnalysisSetRequest: AiTool = {
    name: 'start_analysis_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_set_request',
        description:
          'Define a SC que entrará em análise. Aceita UUID, SC-XXXX ou apenas o número.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'start_analysis');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'start_analysis',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const startAnalysisSetRequestNumber: AiTool = {
    name: 'start_analysis_draft_set_request_number',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_set_request_number',
        description:
          'Define o número da solicitação na operadora (string). É o número que a operadora atribui à SC ao recebê-la.',
        parameters: {
          type: 'object',
          properties: { request_number: { type: 'string' } },
          required: ['request_number'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'start_analysis');
      if (blocked) return blocked;
      const v = asText(context, args.request_number);
      if (!v) {
        return buildToolResult({
          status: 'error',
          message: '`request_number` é obrigatório.',
        });
      }
      await draftService.setFields(context.conversationId, 'start_analysis', {
        requestNumber: v,
      } satisfies Partial<StartAnalysisDraftFields>);
      return buildToolResult({ status: 'ok', data: { requestNumber: v } });
    },
  };

  const startAnalysisSetReceivedAt: AiTool = {
    name: 'start_analysis_draft_set_received_at',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_set_received_at',
        description:
          'Define a data em que a operadora recebeu a solicitação (AAAA-MM-DD).',
        parameters: {
          type: 'object',
          properties: { received_at: { type: 'string' } },
          required: ['received_at'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'start_analysis');
      if (blocked) return blocked;
      const v = asIsoDate(asText(context, args.received_at));
      if (!v) {
        return buildToolResult({
          status: 'error',
          message: '`received_at` deve ser AAAA-MM-DD.',
        });
      }
      await draftService.setFields(context.conversationId, 'start_analysis', {
        receivedAt: v,
      } satisfies Partial<StartAnalysisDraftFields>);
      return buildToolResult({ status: 'ok', data: { receivedAt: v } });
    },
  };

  const startAnalysisSetQuotation: AiTool = {
    name: 'start_analysis_draft_set_quotation',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_set_quotation',
        description:
          'Registra uma cotação opcional (1, 2 ou 3) com nº da proposta e data de recebimento. Passe `null` em `number` para limpar a cotação.',
        parameters: {
          type: 'object',
          properties: {
            slot: { type: 'number', enum: [1, 2, 3] },
            number: { type: ['string', 'null'] },
            received_at: { type: ['string', 'null'] },
          },
          required: ['slot', 'number'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'start_analysis');
      if (blocked) return blocked;
      const slot = Number(args.slot);
      if (![1, 2, 3].includes(slot)) {
        return buildToolResult({
          status: 'error',
          message: '`slot` deve ser 1, 2 ou 3.',
        });
      }
      const numberKey =
        `quotation${slot}Number` as keyof StartAnalysisDraftFields;
      const dateKey =
        `quotation${slot}ReceivedAt` as keyof StartAnalysisDraftFields;
      const patch: Record<string, unknown> = {};
      if (args.number === null) {
        patch[numberKey as string] = null;
        patch[dateKey as string] = null;
      } else {
        const num = asText(context, args.number);
        if (!num) {
          return buildToolResult({
            status: 'error',
            message: '`number` é obrigatório (ou `null` para limpar).',
          });
        }
        patch[numberKey as string] = num;
        if (args.received_at !== undefined && args.received_at !== null) {
          const dt = asIsoDate(asText(context, args.received_at));
          if (!dt) {
            return buildToolResult({
              status: 'error',
              message: '`received_at` deve ser AAAA-MM-DD.',
            });
          }
          patch[dateKey as string] = dt;
        }
      }
      await draftService.setFields(
        context.conversationId,
        'start_analysis',
        patch,
      );
      return buildToolResult({ status: 'ok', data: patch });
    },
  };

  const startAnalysisSetNotes: AiTool = {
    name: 'start_analysis_draft_set_notes',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_set_notes',
        description: 'Define observações opcionais sobre a análise.',
        parameters: {
          type: 'object',
          properties: { notes: { type: ['string', 'null'] } },
          required: ['notes'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'start_analysis');
      if (blocked) return blocked;
      const v = args.notes === null ? null : asText(context, args.notes);
      await draftService.setFields(context.conversationId, 'start_analysis', {
        notes: v,
      } satisfies Partial<StartAnalysisDraftFields>);
      return buildToolResult({ status: 'ok', data: { notes: v } });
    },
  };

  const startAnalysisPreview: AiTool = {
    name: 'start_analysis_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_preview',
        description: 'Gera o preview do rascunho de início de análise.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'start_analysis',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de análise ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'start_analysis',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const startAnalysisCommit: AiTool = {
    name: 'start_analysis_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_commit',
        description:
          'Marca a SC como Em Análise após confirmação (`confirm=true`). Avança status SENT → IN_ANALYSIS.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para iniciar a análise, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'start_analysis',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de análise ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const statusError = await assertCurrentStatusIs(
        f.surgeryRequestId!,
        SurgeryRequestStatus.SENT,
      );
      if (statusError) return statusError;

      try {
        await workflowService.startAnalysis(
          f.surgeryRequestId!,
          {
            requestNumber: f.requestNumber!,
            receivedAt: f.receivedAt!,
            quotation1Number: f.quotation1Number ?? undefined,
            quotation1ReceivedAt: f.quotation1ReceivedAt ?? undefined,
            quotation2Number: f.quotation2Number ?? undefined,
            quotation2ReceivedAt: f.quotation2ReceivedAt ?? undefined,
            quotation3Number: f.quotation3Number ?? undefined,
            quotation3ReceivedAt: f.quotation3ReceivedAt ?? undefined,
            notes: f.notes ?? undefined,
            notifyPatient: f.notifyPatient,
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Análise iniciada via draft. Nº operadora: ${f.requestNumber}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Análise da solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId} iniciada com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao iniciar análise: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const startAnalysisCancel: AiTool = {
    name: 'start_analysis_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_cancel',
        description: 'Cancela o rascunho de início de análise.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de análise cancelado.',
      });
    },
  };

  const startAnalysisStatus: AiTool = {
    name: 'start_analysis_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_status',
        description: 'Mostra o estado do rascunho de início de análise.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'start_analysis',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de análise ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  /* ============================================================
   * ACCEPT AUTHORIZATION (IN_ANALYSIS → IN_SCHEDULING)
   * ============================================================ */

  const acceptAuthSetRequest: AiTool = {
    name: 'accept_authorization_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_set_request',
        description:
          'Define a SC cuja autorização será aceita. Aceita UUID, SC-XXXX ou apenas o número.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'accept_authorization');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'accept_authorization',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const acceptAuthSetDateOptions: AiTool = {
    name: 'accept_authorization_draft_set_date_options',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_set_date_options',
        description:
          'Define as opções de data propostas para a cirurgia (1 a 3 datas em AAAA-MM-DD ou ISO). SUBSTITUI a lista atual.',
        parameters: {
          type: 'object',
          properties: {
            date_options: { type: 'array', items: { type: 'string' } },
          },
          required: ['date_options'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'accept_authorization');
      if (blocked) return blocked;
      if (!Array.isArray(args.date_options)) {
        return buildToolResult({
          status: 'error',
          message: '`date_options` deve ser array.',
        });
      }
      if (args.date_options.length < 1 || args.date_options.length > 3) {
        return buildToolResult({
          status: 'error',
          message: '`date_options` deve ter entre 1 e 3 datas.',
        });
      }
      const normalized: string[] = [];
      for (const raw of args.date_options) {
        const iso = asIsoDate(asText(context, raw));
        if (!iso) {
          return buildToolResult({
            status: 'error',
            message: `Data inválida: "${raw}". Use AAAA-MM-DD.`,
          });
        }
        normalized.push(iso);
      }
      await draftService.setFields(
        context.conversationId,
        'accept_authorization',
        {
          dateOptions: normalized,
        } satisfies Partial<AcceptAuthorizationDraftFields>,
      );
      return buildToolResult({
        status: 'ok',
        data: { dateOptions: normalized },
      });
    },
  };

  const acceptAuthPreview: AiTool = {
    name: 'accept_authorization_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_preview',
        description: 'Gera o preview do aceite da autorização.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'accept_authorization',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de aceite ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'accept_authorization',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const acceptAuthCommit: AiTool = {
    name: 'accept_authorization_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_commit',
        description:
          'Aceita a autorização e registra as opções de data após confirmação (`confirm=true`). Avança status IN_ANALYSIS → IN_SCHEDULING.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para aceitar a autorização, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'accept_authorization',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de aceite ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const statusError = await assertCurrentStatusIs(
        f.surgeryRequestId!,
        SurgeryRequestStatus.IN_ANALYSIS,
      );
      if (statusError) return statusError;

      try {
        await workflowService.acceptAuthorization(
          f.surgeryRequestId!,
          {
            dateOptions: f.dateOptions!,
            notifyPatient: f.notifyPatient,
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Autorização aceita via draft. ${f.dateOptions!.length} data(s) proposta(s).`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Autorização aceita para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao aceitar autorização: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const acceptAuthCancel: AiTool = {
    name: 'accept_authorization_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_cancel',
        description: 'Cancela o rascunho de aceite de autorização.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de aceite cancelado.',
      });
    },
  };

  const acceptAuthStatus: AiTool = {
    name: 'accept_authorization_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_status',
        description: 'Mostra o estado do rascunho de aceite.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'accept_authorization',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de aceite ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  /* ============================================================
   * MARK PERFORMED (SCHEDULED → PERFORMED)
   * ============================================================ */

  /**
   * Lista os documentos cirúrgicos pós-operatórios já presentes na SC e
   * indica quais ainda faltam para que a transição possa acontecer.
   */
  async function checkPostSurgeryDocuments(surgeryRequestId: string): Promise<{
    missing: PostSurgeryRequiredDoc[];
    present: string[];
  }> {
    const docs = await documentRepo.findMany({ surgeryRequestId });
    const presentKeys = new Set(
      (docs ?? []).map((d) => d.key).filter((k): k is string => !!k),
    );
    const missing = POST_SURGERY_REQUIRED_DOCS.filter(
      (d) => d.required && !presentKeys.has(d.type),
    );
    return { missing, present: Array.from(presentKeys) };
  }

  const markPerformedSetRequest: AiTool = {
    name: 'mark_performed_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_set_request',
        description:
          'Define a SC que será marcada como realizada. Aceita UUID, SC-XXXX ou apenas o número.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'mark_performed');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'mark_performed',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const markPerformedSetPerformedAt: AiTool = {
    name: 'mark_performed_draft_set_performed_at',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_set_performed_at',
        description:
          'Define a data em que a cirurgia foi realizada (AAAA-MM-DD ou ISO).',
        parameters: {
          type: 'object',
          properties: { performed_at: { type: 'string' } },
          required: ['performed_at'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'mark_performed');
      if (blocked) return blocked;
      const v = asIsoDate(asText(context, args.performed_at));
      if (!v) {
        return buildToolResult({
          status: 'error',
          message: '`performed_at` deve ser data válida (AAAA-MM-DD).',
        });
      }
      await draftService.setFields(context.conversationId, 'mark_performed', {
        surgeryPerformedAt: v,
      } satisfies Partial<MarkPerformedDraftFields>);
      return buildToolResult({
        status: 'ok',
        data: { surgeryPerformedAt: v },
      });
    },
  };

  const markPerformedCheckDocs: AiTool = {
    name: 'mark_performed_draft_check_docs',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_check_docs',
        description:
          'Verifica se os documentos cirúrgicos pós-operatórios obrigatórios já estão anexados à SC. Retorna os tipos presentes e os que faltam.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const blocked = await guardDraft(context, 'mark_performed');
      if (blocked) return blocked;
      const draft = await draftService.getCurrentOfType(
        context.conversationId,
        'mark_performed',
      );
      if (!draft?.fields.surgeryRequestId) {
        return buildToolResult({
          status: 'needs_input',
          message: 'Defina a solicitação primeiro com `*_set_request`.',
          nextRequiredFields: ['surgeryRequestId'],
        });
      }
      const result = await checkPostSurgeryDocuments(
        draft.fields.surgeryRequestId,
      );
      return buildToolResult({
        status: result.missing.length === 0 ? 'ok' : 'needs_input',
        data: {
          presentKeys: result.present,
          missing: result.missing.map((d) => ({
            type: d.type,
            label: d.label,
            hint: d.hint,
          })),
        },
        message:
          result.missing.length === 0
            ? 'Todos os documentos obrigatórios estão anexados.'
            : `Faltam ${result.missing.length} documento(s) obrigatório(s): ${result.missing.map((d) => d.label).join(', ')}.`,
      });
    },
  };

  const markPerformedPreview: AiTool = {
    name: 'mark_performed_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_preview',
        description:
          'Gera o preview da marcação como realizada. Bloqueia se faltarem documentos obrigatórios.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'mark_performed',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de marcação de realizada ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const docs = await checkPostSurgeryDocuments(f.surgeryRequestId!);
      if (docs.missing.length > 0) {
        const lines = docs.missing
          .map((d) => `• ${d.label} — ${d.hint}`)
          .join('\n');
        return buildToolResult({
          status: 'blocked',
          message: `Para marcar como realizada, os seguintes documentos precisam estar anexados à SC (envie pelo WhatsApp como anexo ou pela plataforma):\n${lines}`,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'mark_performed',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const markPerformedCommit: AiTool = {
    name: 'mark_performed_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_commit',
        description:
          'Marca a cirurgia como realizada após confirmação (`confirm=true`). Avança status SCHEDULED → PERFORMED. Falha se os documentos cirúrgicos obrigatórios não estiverem anexados.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para marcar como realizada, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'mark_performed',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const statusError = await assertCurrentStatusIs(
        f.surgeryRequestId!,
        SurgeryRequestStatus.SCHEDULED,
      );
      if (statusError) return statusError;

      const docs = await checkPostSurgeryDocuments(f.surgeryRequestId!);
      if (docs.missing.length > 0) {
        return buildToolResult({
          status: 'blocked',
          message: `Documentos cirúrgicos faltantes: ${docs.missing.map((d) => d.label).join(', ')}.`,
        });
      }

      try {
        await workflowService.markPerformed(
          f.surgeryRequestId!,
          { surgeryPerformedAt: f.surgeryPerformedAt! } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Cirurgia marcada como realizada via draft em ${f.surgeryPerformedAt}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId} marcada como realizada com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao marcar como realizada: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const markPerformedCancel: AiTool = {
    name: 'mark_performed_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_cancel',
        description: 'Cancela o rascunho de marcação como realizada.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de marcação cancelado.',
      });
    },
  };

  const markPerformedStatus: AiTool = {
    name: 'mark_performed_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed_draft_status',
        description: 'Mostra o estado do rascunho de marcação como realizada.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'mark_performed',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho ativo.',
        });
      }
      return buildToolResult({
        status: v.isReady ? 'ok' : 'needs_input',
        data: v.draft.fields,
        nextRequiredFields: v.missing,
      });
    },
  };

  return [
    sendScSetRequest,
    sendScSetMethod,
    sendScSetEmailFields,
    sendScPreview,
    sendScCommit,
    sendScCancel,
    sendScStatus,
    startAnalysisSetRequest,
    startAnalysisSetRequestNumber,
    startAnalysisSetReceivedAt,
    startAnalysisSetQuotation,
    startAnalysisSetNotes,
    startAnalysisPreview,
    startAnalysisCommit,
    startAnalysisCancel,
    startAnalysisStatus,
    acceptAuthSetRequest,
    acceptAuthSetDateOptions,
    acceptAuthPreview,
    acceptAuthCommit,
    acceptAuthCancel,
    acceptAuthStatus,
    markPerformedSetRequest,
    markPerformedSetPerformedAt,
    markPerformedCheckDocs,
    markPerformedPreview,
    markPerformedCommit,
    markPerformedCancel,
    markPerformedStatus,
  ];
}
