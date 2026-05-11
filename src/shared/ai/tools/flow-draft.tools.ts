import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { resolveAuthorizedRequest } from './action.tools';
import { detokenizeArg } from '../pii/tool-pii-helpers';
import { buildToolResult } from './tool-result';
import {
  ContestationDraftFields,
  InvoiceDraftFields,
  OperationDraftType,
  SchedulingDraftFields,
  UpdateScDraftFields,
} from '../drafts/operation-draft.types';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

interface FlowDraftDeps {
  draftService: OperationDraftService;
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: SurgeryRequestWorkflowService;
  activityRepo: SurgeryRequestActivityRepository;
  patientRepo: PatientRepository;
}

function asText(context: ToolContext, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const v = detokenizeArg(context, raw as any);
  const t = String(v ?? '').trim();
  return t || null;
}

function asNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function asIsoDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!ISO_DATE_REGEX.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/**
 * Tools de fluxo complexo (Fase 5) que dependem de um draft estruturado:
 *  - `invoice_draft_*` — faturamento.
 *  - `contestation_draft_*` — contestação de autorização ou pagamento.
 *  - `scheduling_draft_*` — agendamento (sugerir opções e/ou confirmar data).
 *  - `update_sc_draft_*` — atualização de dados clínicos / administrativos / paciente.
 *
 * Cada um tem `*_draft_set_*`, `_status`, `_preview`, `_commit`, `_cancel`.
 */
export function buildFlowDraftTools(deps: FlowDraftDeps): AiTool[] {
  const {
    draftService,
    surgeryRequestRepo,
    workflowService,
    activityRepo,
    patientRepo,
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
   * Resolve `surgeryRequestId` aceitando UUID ou protocolo (SC-XXXX / XXXX)
   * e grava no draft junto com o `surgeryRequestLabel` (= protocolo formatado).
   */
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
   * INVOICE
   * ============================================================ */

  const invoiceSetRequest: AiTool = {
    name: 'invoice_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_set_request',
        description:
          'Define a solicitação cirúrgica que será faturada. Aceita UUID, SC-XXXX ou apenas o número.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'invoice');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'invoice',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const invoiceSetProtocol: AiTool = {
    name: 'invoice_draft_set_protocol',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_set_protocol',
        description: 'Define o protocolo de faturamento (string).',
        parameters: {
          type: 'object',
          properties: { invoice_protocol: { type: 'string' } },
          required: ['invoice_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'invoice');
      if (blocked) return blocked;
      const protocol = asText(context, args.invoice_protocol);
      if (!protocol) {
        return buildToolResult({
          status: 'error',
          message: '`invoice_protocol` é obrigatório.',
        });
      }
      await draftService.setFields(context.conversationId, 'invoice', {
        invoiceProtocol: protocol,
      } satisfies Partial<InvoiceDraftFields>);
      return buildToolResult({
        status: 'ok',
        data: { invoiceProtocol: protocol },
      });
    },
  };

  const invoiceSetValue: AiTool = {
    name: 'invoice_draft_set_value',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_set_value',
        description: 'Define o valor faturado (R$). Deve ser >= 0.',
        parameters: {
          type: 'object',
          properties: { invoice_value: { type: 'number' } },
          required: ['invoice_value'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'invoice');
      if (blocked) return blocked;
      const value = asNumber(args.invoice_value);
      if (value === null) {
        return buildToolResult({
          status: 'error',
          message: '`invoice_value` deve ser número >= 0.',
        });
      }
      await draftService.setFields(context.conversationId, 'invoice', {
        invoiceValue: value,
      } satisfies Partial<InvoiceDraftFields>);
      return buildToolResult({ status: 'ok', data: { invoiceValue: value } });
    },
  };

  const invoiceSetSentAt: AiTool = {
    name: 'invoice_draft_set_sent_at',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_set_sent_at',
        description: 'Define a data de envio da fatura (AAAA-MM-DD).',
        parameters: {
          type: 'object',
          properties: { invoice_sent_at: { type: 'string' } },
          required: ['invoice_sent_at'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'invoice');
      if (blocked) return blocked;
      const sentAt = asIsoDate(asText(context, args.invoice_sent_at));
      if (!sentAt) {
        return buildToolResult({
          status: 'error',
          message: '`invoice_sent_at` deve ser data válida (AAAA-MM-DD).',
        });
      }
      await draftService.setFields(context.conversationId, 'invoice', {
        invoiceSentAt: sentAt,
      } satisfies Partial<InvoiceDraftFields>);
      return buildToolResult({ status: 'ok', data: { invoiceSentAt: sentAt } });
    },
  };

  const invoiceSetPaymentDeadline: AiTool = {
    name: 'invoice_draft_set_payment_deadline',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_set_payment_deadline',
        description:
          'Define o prazo de pagamento (AAAA-MM-DD) e opcionalmente fixa como padrão do convênio. Aceita `null` para limpar.',
        parameters: {
          type: 'object',
          properties: {
            payment_deadline: { type: ['string', 'null'] },
            set_as_default_for_health_plan: { type: 'boolean' },
          },
          required: ['payment_deadline'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'invoice');
      if (blocked) return blocked;
      if (args.payment_deadline === null) {
        await draftService.setFields(context.conversationId, 'invoice', {
          paymentDeadline: null,
          setAsDefaultForHealthPlan: undefined,
        });
        return buildToolResult({
          status: 'ok',
          data: { paymentDeadline: null },
        });
      }
      const deadline = asIsoDate(asText(context, args.payment_deadline));
      if (!deadline) {
        return buildToolResult({
          status: 'error',
          message: '`payment_deadline` deve ser data válida.',
        });
      }
      await draftService.setFields(context.conversationId, 'invoice', {
        paymentDeadline: deadline,
        setAsDefaultForHealthPlan:
          args.set_as_default_for_health_plan === true ? true : undefined,
      });
      return buildToolResult({
        status: 'ok',
        data: { paymentDeadline: deadline },
      });
    },
  };

  const invoicePreview: AiTool = {
    name: 'invoice_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_preview',
        description: 'Gera o preview do rascunho de faturamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(context.conversationId, 'invoice');
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de faturamento ativo.',
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
        'invoice',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const invoiceCommit: AiTool = {
    name: 'invoice_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_commit',
        description:
          'Registra o faturamento da SC após confirmação (`confirm=true`).',
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
            'Para registrar o faturamento, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(context.conversationId, 'invoice');
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de faturamento ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const fields = v.draft.fields;
      try {
        await workflowService.invoiceRequest(
          fields.surgeryRequestId!,
          {
            invoiceProtocol: fields.invoiceProtocol!,
            invoiceValue: fields.invoiceValue!,
            invoiceSentAt: fields.invoiceSentAt!,
            paymentDeadline: fields.paymentDeadline ?? undefined,
            setAsDefaultForHealthPlan:
              fields.setAsDefaultForHealthPlan === true,
          },
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: fields.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Faturamento registrado via draft. Protocolo: ${fields.invoiceProtocol}, valor: ${fields.invoiceValue?.toFixed(2)}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: fields.surgeryRequestId,
          label: fields.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          data: { surgeryRequestId: fields.surgeryRequestId },
          message: `Faturamento registrado com sucesso para a solicitação ${fields.surgeryRequestLabel ?? fields.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao faturar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const invoiceCancel: AiTool = {
    name: 'invoice_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_cancel',
        description: 'Cancela o rascunho de faturamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de faturamento cancelado.',
      });
    },
  };

  const invoiceStatus: AiTool = {
    name: 'invoice_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_status',
        description: 'Mostra o estado do rascunho de faturamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(context.conversationId, 'invoice');
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de faturamento ativo.',
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
   * CONTESTATION (autorização ou pagamento)
   * ============================================================ */

  const contestSetRequest: AiTool = {
    name: 'contestation_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_set_request',
        description: 'Define a SC a ser contestada (UUID ou protocolo).',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'contestation');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'contestation',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const contestSetType: AiTool = {
    name: 'contestation_draft_set_type',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_set_type',
        description:
          'Tipo de contestação: "AUTHORIZATION" (autorização recusada/parcial) ou "PAYMENT" (pagamento divergente).',
        parameters: {
          type: 'object',
          properties: {
            contestation_type: {
              type: 'string',
              enum: ['AUTHORIZATION', 'PAYMENT'],
            },
          },
          required: ['contestation_type'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'contestation');
      if (blocked) return blocked;
      const t = String(args.contestation_type ?? '').toUpperCase();
      if (t !== 'AUTHORIZATION' && t !== 'PAYMENT') {
        return buildToolResult({
          status: 'error',
          message: '`contestation_type` deve ser AUTHORIZATION ou PAYMENT.',
        });
      }
      await draftService.setFields(context.conversationId, 'contestation', {
        contestationType: t as 'AUTHORIZATION' | 'PAYMENT',
      } satisfies Partial<ContestationDraftFields>);
      return buildToolResult({
        status: 'ok',
        data: { contestationType: t },
      });
    },
  };

  const contestSetReason: AiTool = {
    name: 'contestation_draft_set_reason',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_set_reason',
        description: 'Motivo da contestação (texto livre).',
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'contestation');
      if (blocked) return blocked;
      const reason = asText(context, args.reason);
      if (!reason) {
        return buildToolResult({
          status: 'error',
          message: '`reason` é obrigatório.',
        });
      }
      await draftService.setFields(context.conversationId, 'contestation', {
        reason,
      });
      return buildToolResult({ status: 'ok', data: { reason } });
    },
  };

  const contestSetDelivery: AiTool = {
    name: 'contestation_draft_set_delivery',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_set_delivery',
        description:
          'Define forma de envio e payload de e-mail (quando aplicável). Para AUTHORIZATION, `method` pode ser email/download/document. Para PAYMENT, sempre email — preencha `to`, `subject` e `message`.',
        parameters: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['email', 'download', 'document'] },
            to: { type: 'string' },
            subject: { type: 'string' },
            message: { type: 'string' },
            attachments: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'contestation');
      if (blocked) return blocked;
      const patch: Partial<ContestationDraftFields> = {};
      if (args.method !== undefined) {
        const m = String(args.method).toLowerCase();
        if (!['email', 'download', 'document'].includes(m)) {
          return buildToolResult({
            status: 'error',
            message: '`method` deve ser email/download/document.',
          });
        }
        patch.method = m as 'email' | 'download' | 'document';
      }
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
        if (!v) {
          return buildToolResult({
            status: 'error',
            message: '`message` não pode ser vazia.',
          });
        }
        patch.message = v;
      }
      if (args.attachments !== undefined) {
        if (
          !Array.isArray(args.attachments) ||
          args.attachments.some((x: unknown) => typeof x !== 'string')
        ) {
          return buildToolResult({
            status: 'error',
            message: '`attachments` deve ser array de strings.',
          });
        }
        patch.attachments = args.attachments as string[];
      }
      if (Object.keys(patch).length === 0) {
        return buildToolResult({
          status: 'error',
          message:
            'Informe ao menos um campo (method/to/subject/message/attachments).',
        });
      }
      await draftService.setFields(
        context.conversationId,
        'contestation',
        patch,
      );
      return buildToolResult({ status: 'ok', data: patch });
    },
  };

  const contestPreview: AiTool = {
    name: 'contestation_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_preview',
        description: 'Gera o preview da contestação.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'contestation',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de contestação ativo.',
        });
      }
      const f = v.draft.fields;
      const missing = [...v.missing];
      if (f.contestationType === 'PAYMENT') {
        if (!f.to) missing.push('to');
        if (!f.subject) missing.push('subject');
        if (!f.message) missing.push('message');
      }
      if (f.contestationType === 'AUTHORIZATION' && f.method === 'email') {
        if (!f.to) missing.push('to');
        if (!f.subject) missing.push('subject');
        if (!f.message) missing.push('message');
      }
      if (missing.length) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${missing.join(', ')}.`,
          nextRequiredFields: missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'contestation',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const contestCommit: AiTool = {
    name: 'contestation_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_commit',
        description:
          'Registra a contestação após confirmação (`confirm=true`). Roteia para `contestAuthorization` ou `contestPayment` conforme o `contestationType`.',
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
            'Para registrar a contestação, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'contestation',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de contestação ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      try {
        if (f.contestationType === 'AUTHORIZATION') {
          await workflowService.contestAuthorization(
            f.surgeryRequestId!,
            {
              reason: f.reason!,
              method: (f.method ?? 'document') as any,
              to: f.to,
              subject: f.subject,
              message: f.message,
              attachments: f.attachments,
            } as any,
            context.userId,
          );
        } else {
          await workflowService.contestPayment(
            f.surgeryRequestId!,
            {
              to: f.to!,
              subject: f.subject!,
              message: f.message!,
              attachments: f.attachments,
            } as any,
            context.userId,
          );
        }
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Contestação (${f.contestationType}) registrada via draft.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Contestação registrada com sucesso para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao contestar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const contestCancel: AiTool = {
    name: 'contestation_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_cancel',
        description: 'Cancela o rascunho de contestação.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de contestação cancelado.',
      });
    },
  };

  const contestStatus: AiTool = {
    name: 'contestation_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_status',
        description: 'Mostra o estado do rascunho de contestação.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'contestation',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de contestação ativo.',
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
   * SCHEDULING
   * ============================================================ */

  const scheduleSetRequest: AiTool = {
    name: 'scheduling_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_set_request',
        description: 'Define a SC a ser agendada.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'scheduling');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'scheduling',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const scheduleSetDateOptions: AiTool = {
    name: 'scheduling_draft_set_date_options',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_set_date_options',
        description:
          'Define as opções de data (1 a 3 datas no formato AAAA-MM-DD).',
        parameters: {
          type: 'object',
          properties: {
            date_options: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['date_options'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'scheduling');
      if (blocked) return blocked;
      const arr = Array.isArray(args.date_options) ? args.date_options : [];
      if (arr.length < 1 || arr.length > 3) {
        return buildToolResult({
          status: 'error',
          message: '`date_options` deve ter entre 1 e 3 datas.',
        });
      }
      const normalized: string[] = [];
      for (const d of arr) {
        const iso = asIsoDate(d);
        if (!iso) {
          return buildToolResult({
            status: 'error',
            message: `Data inválida: "${String(d)}".`,
          });
        }
        normalized.push(iso);
      }
      await draftService.setFields(context.conversationId, 'scheduling', {
        dateOptions: normalized,
      } satisfies Partial<SchedulingDraftFields>);
      return buildToolResult({
        status: 'ok',
        data: { dateOptions: normalized },
      });
    },
  };

  const scheduleSetConfirmedDate: AiTool = {
    name: 'scheduling_draft_set_confirmed_date',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_set_confirmed_date',
        description:
          'Define a data confirmada — informando o índice (0, 1 ou 2) entre as `dateOptions` previamente cadastradas pelo convênio. A data espelhada é gravada em `confirmedDate`.',
        parameters: {
          type: 'object',
          properties: {
            confirmed_date_index: { type: 'number' },
            confirmed_date: { type: 'string' },
          },
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'scheduling');
      if (blocked) return blocked;
      const patch: Partial<SchedulingDraftFields> = {};
      if (args.confirmed_date_index !== undefined) {
        const idx = Number(args.confirmed_date_index);
        if (!Number.isInteger(idx) || idx < 0 || idx > 2) {
          return buildToolResult({
            status: 'error',
            message: '`confirmed_date_index` deve ser 0, 1 ou 2.',
          });
        }
        patch.confirmedDateIndex = idx;
      }
      if (args.confirmed_date !== undefined) {
        const iso = asIsoDate(args.confirmed_date);
        if (!iso) {
          return buildToolResult({
            status: 'error',
            message: '`confirmed_date` deve ser data válida.',
          });
        }
        patch.confirmedDate = iso;
      }
      if (Object.keys(patch).length === 0) {
        return buildToolResult({
          status: 'error',
          message: 'Informe `confirmed_date_index` e/ou `confirmed_date`.',
        });
      }
      await draftService.setFields(context.conversationId, 'scheduling', patch);
      return buildToolResult({ status: 'ok', data: patch });
    },
  };

  const schedulePreview: AiTool = {
    name: 'scheduling_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_preview',
        description: 'Gera o preview do rascunho de agendamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'scheduling',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de agendamento ativo.',
        });
      }
      const f = v.draft.fields;
      // Agendamento exige: ou `dateOptions` (para enviar opções) ou
      // `confirmedDateIndex`/`confirmedDate` (para confirmar uma data).
      const hasDateOptions =
        Array.isArray(f.dateOptions) && f.dateOptions.length > 0;
      const hasConfirmation =
        f.confirmedDateIndex !== undefined || !!f.confirmedDate;
      if (!hasDateOptions && !hasConfirmation) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Informe `dateOptions` (1 a 3 datas) ou confirme uma data (`confirmedDateIndex`/`confirmedDate`).',
          nextRequiredFields: ['dateOptions', 'confirmedDateIndex'],
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'scheduling',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const scheduleCommit: AiTool = {
    name: 'scheduling_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_commit',
        description:
          'Aplica o agendamento após confirmação (`confirm=true`). Se `dateOptions` está preenchido, atualiza as opções. Se `confirmedDateIndex` está preenchido, confirma a data.',
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
            'Para aplicar o agendamento, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'scheduling',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de agendamento ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      try {
        const hasOptions =
          Array.isArray(f.dateOptions) && f.dateOptions.length > 0;
        if (hasOptions) {
          await workflowService.updateDateOptions(
            f.surgeryRequestId!,
            { dateOptions: f.dateOptions } as any,
            context.userId,
          );
        }
        if (f.confirmedDateIndex !== undefined) {
          await workflowService.confirmDate(
            f.surgeryRequestId!,
            { selectedDateIndex: f.confirmedDateIndex } as any,
            context.userId,
          );
        }
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Agendamento via draft: ${hasOptions ? 'opções definidas' : ''}${
            f.confirmedDateIndex !== undefined
              ? `${hasOptions ? '; ' : ''}data confirmada (opção #${f.confirmedDateIndex + 1})`
              : ''
          }.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Agendamento aplicado para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao agendar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const scheduleCancel: AiTool = {
    name: 'scheduling_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_cancel',
        description: 'Cancela o rascunho de agendamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de agendamento cancelado.',
      });
    },
  };

  const scheduleStatus: AiTool = {
    name: 'scheduling_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_status',
        description: 'Mostra o estado do rascunho de agendamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'scheduling',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de agendamento ativo.',
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
   * UPDATE SC (clínico / admin / paciente)
   * ============================================================ */

  // Campos válidos por escopo. Bloqueamos campos fora do schema para evitar
  // que o LLM passe lixo.
  const VALID_FIELDS_BY_SCOPE: Record<string, ReadonlyArray<string>> = {
    clinical: [
      'diagnosis',
      'medicalReport',
      'patientHistory',
      'surgeryDescription',
      'cidCode',
    ],
    admin: [
      'healthPlanRegistration',
      'healthPlanType',
      'healthPlanProtocol',
      'priority',
    ],
    patient: ['name', 'birthDate', 'cpf', 'phone', 'address', 'zipCode'],
  };

  const updateSetRequest: AiTool = {
    name: 'update_sc_draft_set_request',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_set_request',
        description: 'Define a SC a atualizar.',
        parameters: {
          type: 'object',
          properties: { surgery_request_id_or_protocol: { type: 'string' } },
          required: ['surgery_request_id_or_protocol'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'update_sc');
      if (blocked) return blocked;
      return setSurgeryRequestField(
        context,
        'update_sc',
        args.surgery_request_id_or_protocol,
      );
    },
  };

  const updateSetScope: AiTool = {
    name: 'update_sc_draft_set_scope',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_set_scope',
        description:
          'Define o escopo da atualização: "clinical" (laudo/diagnóstico), "admin" (convênio/prioridade) ou "patient" (dados cadastrais do paciente vinculado).',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['clinical', 'admin', 'patient'] },
          },
          required: ['scope'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'update_sc');
      if (blocked) return blocked;
      const scope = String(args.scope ?? '').toLowerCase();
      if (!['clinical', 'admin', 'patient'].includes(scope)) {
        return buildToolResult({
          status: 'error',
          message: '`scope` deve ser clinical/admin/patient.',
        });
      }
      // Mudar de escopo limpa as `changes` para evitar contaminação.
      const current = await draftService.getCurrentOfType(
        context.conversationId,
        'update_sc',
      );
      const newChanges =
        current?.fields.scope === scope ? current.fields.changes : {};
      await draftService.setFields(context.conversationId, 'update_sc', {
        scope: scope as 'clinical' | 'admin' | 'patient',
        changes: newChanges,
      } satisfies Partial<UpdateScDraftFields>);
      return buildToolResult({ status: 'ok', data: { scope } });
    },
  };

  const updateSetField: AiTool = {
    name: 'update_sc_draft_set_field',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_set_field',
        description:
          'Acrescenta UM campo + valor às `changes`. Exige `scope` definido. Lista de campos válidos por escopo: clinical={diagnosis, medicalReport, patientHistory, surgeryDescription, cidCode}; admin={healthPlanRegistration, healthPlanType, healthPlanProtocol, priority}; patient={name, birthDate, cpf, phone, address, zipCode}.',
        parameters: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            value: {},
          },
          required: ['field', 'value'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      const blocked = await guardDraft(context, 'update_sc');
      if (blocked) return blocked;
      const current = await draftService.getCurrentOfType(
        context.conversationId,
        'update_sc',
      );
      if (!current?.fields.scope) {
        return buildToolResult({
          status: 'blocked',
          message: 'Defina o `scope` antes (use update_sc_draft_set_scope).',
        });
      }
      const field = String(args.field ?? '').trim();
      const allowed = VALID_FIELDS_BY_SCOPE[current.fields.scope] ?? [];
      if (!allowed.includes(field)) {
        return buildToolResult({
          status: 'error',
          message: `Campo "${field}" não é válido para o escopo "${current.fields.scope}". Permitidos: ${allowed.join(', ')}.`,
        });
      }
      const rawValue = args.value;
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        return buildToolResult({
          status: 'error',
          message: '`value` não pode ser vazio.',
        });
      }
      // Para campos sensíveis (clínicos), detokeniza antes de salvar.
      const sensitive = [
        'diagnosis',
        'medicalReport',
        'patientHistory',
        'surgeryDescription',
      ];
      const value = sensitive.includes(field)
        ? asText(context, rawValue)
        : rawValue;
      const nextChanges = { ...(current.fields.changes ?? {}), [field]: value };
      await draftService.setFields(context.conversationId, 'update_sc', {
        changes: nextChanges,
      });
      return buildToolResult({
        status: 'ok',
        data: {
          field,
          value: sensitive.includes(field) ? '[REDACTED]' : value,
        },
      });
    },
  };

  const updatePreview: AiTool = {
    name: 'update_sc_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_preview',
        description: 'Gera o preview da atualização da SC.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'update_sc',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de atualização ativo.',
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
        'update_sc',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };

  const updateCommit: AiTool = {
    name: 'update_sc_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_commit',
        description:
          'Aplica a atualização após confirmação (`confirm=true`). Roteia por `scope`: clinical/admin → `surgeryRequestRepo.update`; patient → `patientRepo.update`.',
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
            'Para aplicar a atualização, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'update_sc',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de atualização ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const changeKeys = Object.keys(f.changes ?? {});
      if (!changeKeys.length) {
        return buildToolResult({
          status: 'error',
          message: 'Nenhuma alteração informada.',
        });
      }
      try {
        if (f.scope === 'patient') {
          const request = await surgeryRequestRepo.findOneSimple({
            id: f.surgeryRequestId,
          } as any);
          if (!request?.patientId) {
            return buildToolResult({
              status: 'error',
              message: 'Não foi possível localizar o paciente vinculado.',
            });
          }
          await patientRepo.update(request.patientId, f.changes as any);
        } else {
          await surgeryRequestRepo.update(
            f.surgeryRequestId!,
            f.changes as any,
          );
        }
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Atualização (${f.scope}) via draft. Campos: ${changeKeys.join(', ')}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Atualização aplicada com sucesso na solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao atualizar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };

  const updateCancel: AiTool = {
    name: 'update_sc_draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_cancel',
        description: 'Cancela o rascunho de atualização.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      await draftService.cancel(context.conversationId);
      return buildToolResult({
        status: 'ok',
        message: 'Rascunho de atualização cancelado.',
      });
    },
  };

  const updateStatus: AiTool = {
    name: 'update_sc_draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'update_sc_draft_status',
        description: 'Mostra o estado do rascunho de atualização.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(
        context.conversationId,
        'update_sc',
      );
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de atualização ativo.',
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
    invoiceSetRequest,
    invoiceSetProtocol,
    invoiceSetValue,
    invoiceSetSentAt,
    invoiceSetPaymentDeadline,
    invoicePreview,
    invoiceCommit,
    invoiceCancel,
    invoiceStatus,
    contestSetRequest,
    contestSetType,
    contestSetReason,
    contestSetDelivery,
    contestPreview,
    contestCommit,
    contestCancel,
    contestStatus,
    scheduleSetRequest,
    scheduleSetDateOptions,
    scheduleSetConfirmedDate,
    schedulePreview,
    scheduleCommit,
    scheduleCancel,
    scheduleStatus,
    updateSetRequest,
    updateSetScope,
    updateSetField,
    updatePreview,
    updateCommit,
    updateCancel,
    updateStatus,
  ];
}
