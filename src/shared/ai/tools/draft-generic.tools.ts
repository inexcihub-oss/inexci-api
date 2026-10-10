import OpenAI from 'openai';
import { AiTool, ANY_AUTHENTICATED, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { buildToolResult } from './tool-result';
import {
  DRAFT_TYPE_LABELS,
  REQUIRED_FIELDS_BY_TYPE,
  OperationDraftType,
} from '../drafts/operation-draft.types';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { PiiCategory } from '../services/pii-vault.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { resolveAuthorizedRequest } from './helpers/surgery-request-access';

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
    tussItems: 'any',
    opmeItems: 'any',
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
    attachments: 'string[]',
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
    notifyPatient: 'boolean',
  },
};

const DRAFT_TYPES = Object.keys(VALID_FIELDS_BY_TYPE) as OperationDraftType[];

const PII_FIELD_CATEGORY: Record<string, PiiCategory> = {
  cpf: 'cpf',
  phone: 'phone',
  email: 'email',
  birthDate: 'birth_date',
  to: 'email',
};

function tokenizeFieldValue(
  context: ToolContext,
  toolName: 'draft_update' | 'draft_status',
  field: string,
  value: unknown,
): unknown {
  const category = PII_FIELD_CATEGORY[field];
  if (!category || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string'
        ? tokenizePii(context, toolName, category, item)
        : item,
    );
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return tokenizePii(context, toolName, category, value);
  }
  return value;
}

function tokenizeDraftFields(
  context: ToolContext,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      tokenizeFieldValue(context, 'draft_status', field, value),
    ]),
  );
}

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
  surgeryRequestRepo: SurgeryRequestRepository;
}

export function buildDraftGenericTools(deps: DraftGenericDeps): AiTool[] {
  const { draftService, surgeryRequestRepo } = deps;

  const draftUpdate: AiTool = {
    name: 'draft_update',
    requiredPermission: ANY_AUTHENTICATED,
    definition: {
      type: 'function',
      function: {
        name: 'draft_update',
        description: [
          'Atualiza um campo de qualquer rascunho ativo.',
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

      const draftType = args.draft_type as OperationDraftType;
      if (!DRAFT_TYPES.includes(draftType)) {
        return buildToolResult({
          status: 'error',
          message: `\`draft_type\` inválido: "${draftType}". Use um dos tipos: ${DRAFT_TYPES.join(', ')}.`,
        });
      }

      const fieldName = String(args.field ?? '').trim();
      const fieldMeta = VALID_FIELDS_BY_TYPE[draftType];
      if (!fieldMeta[fieldName]) {
        const validFields = Object.keys(fieldMeta).join(', ');
        return buildToolResult({
          status: 'error',
          message: `Campo "${fieldName}" não é válido para o tipo "${draftType}". Campos válidos: ${validFields}.`,
        });
      }

      const expectedType = fieldMeta[fieldName];
      const rawValue = args.value;
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

      if (fieldName === 'surgeryRequestId') {
        const { error: erroDeAcesso } = await resolveAuthorizedRequest(
          surgeryRequestRepo,
          value,
          context,
        );
        if (erroDeAcesso) {
          return buildToolResult({ status: 'error', message: erroDeAcesso });
        }
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
        data: {
          field: fieldName,
          value: tokenizeFieldValue(context, 'draft_update', fieldName, value),
        },
        message: `Campo "${fieldName}" atualizado.`,
        nextRequiredFields: validation.missing,
      });
    },
  };

  const draftStatus: AiTool = {
    name: 'draft_status',
    requiredPermission: ANY_AUTHENTICATED,
    definition: {
      type: 'function',
      function: {
        name: 'draft_status',
        description:
          'Retorna o estado atual do rascunho ativo (tipo, campos preenchidos, campos obrigatórios pendentes).',
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

      const expectedType = args.draft_type as OperationDraftType | undefined;
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
          fields: tokenizeDraftFields(
            context,
            draft.fields as Record<string, unknown>,
          ),
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

  const draftCancel: AiTool = {
    name: 'draft_cancel',
    requiredPermission: ANY_AUTHENTICATED,
    definition: {
      type: 'function',
      function: {
        name: 'draft_cancel',
        description:
          'Cancela o rascunho ativo sem persistir nada. Use quando o usuário desistir do fluxo.',
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

      const expectedType = args.draft_type as OperationDraftType | undefined;
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
