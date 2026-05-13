import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { buildToolResult } from './tool-result';
import {
  DRAFT_TYPE_LABELS,
  REQUIRED_FIELDS_BY_TYPE,
  OperationDraftType,
} from '../drafts/operation-draft.types';
import { detokenizeArg } from '../pii/tool-pii-helpers';

/**
 * Campos válidos por tipo de draft, com tipo esperado para coerção/validação
 * básica. Usado pela tool `draft_update` para evitar que o LLM grave campos
 * inexistentes.
 *
 * `'any'` indica campos sem restrição de tipo (objetos, arrays, valores livres).
 */
const VALID_FIELDS_BY_TYPE: Record<
  OperationDraftType,
  Record<string, 'string' | 'number' | 'boolean' | 'string[]' | 'any' | 'null'>
> = {
  create_sc: {
    patientId: 'string',
    patientLabel: 'string',
    doctorId: 'string',
    doctorLabel: 'string',
    procedureId: 'string',
    procedureLabel: 'string',
    hospitalId: 'any',
    hospitalLabel: 'any',
    healthPlanId: 'any',
    healthPlanLabel: 'any',
    priority: 'string',
    preferredDates: 'string[]',
    notes: 'any',
  },
  create_patient: {
    name: 'string',
    cpf: 'any',
    phone: 'string',
    email: 'any',
    birthDate: 'any',
    gender: 'any',
    doctorId: 'string',
    doctorLabel: 'string',
  },
  create_hospital: { name: 'string' },
  create_health_plan: { name: 'string' },
  create_procedure: { name: 'string' },
  invoice: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    invoiceProtocol: 'string',
    invoiceValue: 'number',
    invoiceSentAt: 'string',
    paymentDeadline: 'any',
    setAsDefaultForHealthPlan: 'boolean',
    notes: 'any',
  },
  contestation: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    contestationType: 'string',
    reason: 'string',
    method: 'any',
    to: 'any',
    subject: 'any',
    message: 'any',
    attachments: 'any',
    notes: 'any',
  },
  scheduling: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    dateOptions: 'string[]',
    confirmedDateIndex: 'number',
    confirmedDate: 'string',
  },
  update_sc: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    scope: 'string',
    changes: 'any',
  },
  send_sc: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    method: 'string',
    to: 'any',
    subject: 'any',
    message: 'any',
    notifyPatient: 'boolean',
  },
  start_analysis: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    requestNumber: 'string',
    receivedAt: 'string',
    quotation1Number: 'any',
    quotation1ReceivedAt: 'any',
    quotation2Number: 'any',
    quotation2ReceivedAt: 'any',
    quotation3Number: 'any',
    quotation3ReceivedAt: 'any',
    notes: 'any',
    notifyPatient: 'boolean',
  },
  accept_authorization: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    dateOptions: 'string[]',
    notifyPatient: 'boolean',
  },
  mark_performed: {
    surgeryRequestId: 'string',
    surgeryRequestLabel: 'string',
    surgeryPerformedAt: 'string',
  },
};

const DRAFT_TYPES = Object.keys(VALID_FIELDS_BY_TYPE) as OperationDraftType[];

function coerceValue(
  raw: unknown,
  expectedType: string,
  context: ToolContext,
): unknown {
  if (raw === null || raw === undefined) return null;

  const detokenized = detokenizeArg(context, raw as any) ?? raw;

  if (expectedType === 'number') {
    const n = Number(detokenized);
    if (!Number.isFinite(n)) return detokenized;
    return n;
  }
  if (expectedType === 'boolean') {
    if (typeof detokenized === 'boolean') return detokenized;
    if (detokenized === 'true') return true;
    if (detokenized === 'false') return false;
    return Boolean(detokenized);
  }
  if (expectedType === 'string[]') {
    if (Array.isArray(detokenized)) return detokenized.map(String);
    if (typeof detokenized === 'string') {
      return detokenized
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [String(detokenized)];
  }
  return detokenized;
}

export interface DraftGenericDeps {
  draftService: OperationDraftService;
}

/**
 * Constrói as três tools globais de draft (sempre registradas após a Fase 5
 * do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`):
 *
 *  - `draft_update`  — atualiza qualquer campo de qualquer draft ativo.
 *  - `draft_status`  — exibe o status e campos do draft atual.
 *  - `draft_cancel`  — cancela o draft ativo.
 *
 * Substituíram os ~70 setters individuais (`*_draft_set_*`) e as
 * 13 tools per-type `*_draft_status` e `*_draft_cancel`, que foram removidos
 * fisicamente do registry — não há mais rollback parcial via feature flag.
 */
export function buildDraftGenericTools(deps: DraftGenericDeps): AiTool[] {
  const { draftService } = deps;

  // ─── draft_update ──────────────────────────────────────────────────────────

  const draftUpdate: AiTool = {
    name: 'draft_update',
    definition: {
      type: 'function',
      function: {
        name: 'draft_update',
        description: [
          'Atualiza um campo de qualquer rascunho ativo.',
          'Substitui as tools `*_draft_set_*` individuais.',
          'Exemplos:',
          '  • draft_update(create_sc, priority, "HIGH")',
          '  • draft_update(invoice, invoiceValue, 1500.00)',
          '  • draft_update(scheduling, dateOptions, ["2026-06-01","2026-06-05"])',
          '',
          'Campos de entidade (patientId, hospitalId, etc.) devem ser UUIDs já resolvidos.',
          'Use `query_patients` / `query_surgery_requests` para resolver nomes em IDs antes de chamar esta tool.',
        ].join('\n'),
        parameters: {
          type: 'object',
          properties: {
            draft_type: {
              type: 'string',
              enum: DRAFT_TYPES,
              description: 'Tipo de rascunho ativo.',
            },
            field: {
              type: 'string',
              description:
                'Nome do campo a atualizar (camelCase, ex: "patientId", "invoiceValue").',
            },
            value: {
              description:
                'Novo valor. Aceita string, number, boolean, null ou array de strings.',
            },
          },
          required: ['draft_type', 'field', 'value'],
        },
      },
    } as OpenAI.ChatCompletionTool,

    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }

      const draftType = (args as any).draft_type as OperationDraftType;
      if (!DRAFT_TYPES.includes(draftType)) {
        return buildToolResult({
          status: 'error',
          message: `\`draft_type\` inválido: "${draftType}". Use um dos tipos: ${DRAFT_TYPES.join(', ')}.`,
        });
      }

      const fieldName = String((args as any).field ?? '').trim();
      const fieldMeta = VALID_FIELDS_BY_TYPE[draftType];
      if (!fieldMeta[fieldName]) {
        const validFields = Object.keys(fieldMeta).join(', ');
        return buildToolResult({
          status: 'error',
          message: `Campo "${fieldName}" não é válido para o tipo "${draftType}". Campos válidos: ${validFields}.`,
        });
      }

      const expectedType = fieldMeta[fieldName];
      const rawValue = (args as any).value;
      const value =
        rawValue === null || rawValue === undefined
          ? null
          : coerceValue(rawValue, expectedType, context);

      const current = await draftService.getCurrent(context.conversationId);
      if (!current) {
        return buildToolResult({
          status: 'blocked',
          message: `Não há rascunho ativo. Chame \`plan_actions\` com intent="${draftType}" para iniciar.`,
        });
      }
      if (current.type !== draftType) {
        return buildToolResult({
          status: 'blocked',
          message: `O rascunho ativo é do tipo "${current.type}", não "${draftType}". Conclua ou cancele antes.`,
        });
      }

      await draftService.setFieldUntyped(
        context.conversationId,
        draftType,
        fieldName,
        value,
      );

      const validation = await draftService.validate(
        context.conversationId,
        draftType,
      );

      return buildToolResult({
        status: validation.isReady ? 'ok' : 'needs_input',
        data: { field: fieldName, value },
        message: `Campo "${fieldName}" atualizado.`,
        nextRequiredFields: validation.missing,
      });
    },
  };

  // ─── draft_status ──────────────────────────────────────────────────────────

  const draftStatus: AiTool = {
    name: 'draft_status',
    definition: {
      type: 'function',
      function: {
        name: 'draft_status',
        description:
          'Retorna o estado atual do rascunho ativo (tipo, campos preenchidos, campos obrigatórios pendentes). Substitui todas as tools `*_draft_status` individuais.',
        parameters: {
          type: 'object',
          properties: {
            draft_type: {
              type: 'string',
              enum: DRAFT_TYPES,
              description:
                'Tipo esperado (opcional). Quando informado, retorna erro se o draft ativo for de outro tipo.',
            },
          },
        },
      },
    } as OpenAI.ChatCompletionTool,

    async execute(args, context: ToolContext): Promise<string> {
      const draft = await draftService.getCurrent(context.conversationId);

      if (!draft) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Não há rascunho ativo. Chame `plan_actions` para iniciar um novo fluxo.',
        });
      }

      const expectedType = (args as any).draft_type as
        | OperationDraftType
        | undefined;
      if (expectedType && draft.type !== expectedType) {
        return buildToolResult({
          status: 'blocked',
          message: `O rascunho ativo é do tipo "${draft.type}", não "${expectedType}".`,
        });
      }

      const validation = await draftService.validate(
        context.conversationId,
        draft.type,
      );

      const label = DRAFT_TYPE_LABELS[draft.type];
      const requiredFields = REQUIRED_FIELDS_BY_TYPE[draft.type];

      return buildToolResult({
        status: validation.isReady ? 'ok' : 'needs_input',
        data: {
          type: draft.type,
          label,
          status: draft.status,
          fields: draft.fields,
          requiredFields,
          missingFields: validation.missing,
          isReady: validation.isReady,
        },
        message: validation.isReady
          ? `Rascunho de "${label}" completo. Use \`*_draft_preview\` para mostrar ao usuário antes de confirmar.`
          : `Rascunho de "${label}" em andamento. Faltam: ${validation.missing.join(', ')}.`,
        nextRequiredFields: validation.missing,
      });
    },
  };

  // ─── draft_cancel ──────────────────────────────────────────────────────────

  const draftCancel: AiTool = {
    name: 'draft_cancel',
    definition: {
      type: 'function',
      function: {
        name: 'draft_cancel',
        description:
          'Cancela o rascunho ativo sem persistir nada. Substitui todas as tools `*_draft_cancel` individuais. Use quando o usuário desistir do fluxo.',
        parameters: {
          type: 'object',
          properties: {
            draft_type: {
              type: 'string',
              enum: DRAFT_TYPES,
              description:
                'Tipo esperado (opcional, segurança). Quando informado, cancela apenas se o draft ativo for deste tipo.',
            },
          },
        },
      },
    } as OpenAI.ChatCompletionTool,

    async execute(args, context: ToolContext): Promise<string> {
      const draft = await draftService.getCurrent(context.conversationId);

      if (!draft) {
        return buildToolResult({
          status: 'ok',
          message: 'Não havia rascunho ativo.',
        });
      }

      const expectedType = (args as any).draft_type as
        | OperationDraftType
        | undefined;
      if (expectedType && draft.type !== expectedType) {
        return buildToolResult({
          status: 'blocked',
          message: `O rascunho ativo é do tipo "${draft.type}", não "${expectedType}". Confirme qual rascunho cancelar.`,
        });
      }

      const label = DRAFT_TYPE_LABELS[draft.type];
      await draftService.cancel(context.conversationId);

      return buildToolResult({
        status: 'ok',
        message: `Rascunho de "${label}" cancelado.`,
      });
    },
  };

  return [draftUpdate, draftStatus, draftCancel];
}
