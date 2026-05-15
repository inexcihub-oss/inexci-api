import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import {
  COMPLEX_INTENTS,
  intentToDraftType,
  OperationDraftType,
} from '../drafts/operation-draft.types';
import { buildToolResult } from './tool-result';

/**
 * Resultado retornado pela tool `plan_actions` ao LLM. Carrega o draft
 * aberto/atualizado e a lista de campos que ainda faltam.
 */
export interface PlanActionsData {
  intent: string;
  draft_type: OperationDraftType | null;
  draft_started: boolean;
  opened_as_subdraft?: boolean;
  next_required_fields: string[];
  plan_steps: string[];
  mentioned_entities: Record<string, unknown>;
}

/**
 * Mapeia intents de cadastro → campo do draft pai (`create_sc`) que
 * será preenchido automaticamente após o commit do sub-draft.
 */
const SUBDRAFT_RETURN_FIELD: Record<string, string> = {
  create_patient: 'patientId',
  create_hospital: 'hospitalId',
  create_health_plan: 'healthPlanId',
  create_procedure: 'procedureId',
};

const PLAN_INTENTS = [
  'create_sc',
  'create_patient',
  'create_hospital',
  'create_health_plan',
  'create_procedure',
  'invoice',
  'contestation',
  'scheduling',
  'update_sc',
  'send_sc',
  'start_analysis',
  'accept_authorization',
  'mark_performed',
  'read_only',
  'smalltalk',
  'unknown',
] as const;

export function buildPlanTools(draftService: OperationDraftService): AiTool[] {
  const planActions: AiTool = {
    name: 'plan_actions',
    definition: {
      type: 'function',
      function: {
        name: 'plan_actions',
        description:
          'OBRIGATÓRIA como PRIMEIRA tool em qualquer turno cuja intenção seja CRIAÇÃO ou EDIÇÃO (fluxos complexos: criar SC, cadastrar paciente/hospital/convênio/procedimento, faturar, contestar, agendar, atualizar dados). Decompõe a mensagem do usuário em intent + entidades mencionadas + plano de etapas. Para leitura/smalltalk/unknown, pode ser pulada. Quando o intent é um fluxo complexo, abre ou retoma o `operation_draft` correspondente.',
        parameters: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              enum: [...PLAN_INTENTS],
              description: 'Classificação da intenção principal do usuário.',
            },
            mentioned_entities: {
              type: 'object',
              description:
                'Entidades citadas na mensagem do usuário (texto cru, conforme aparece — sem tokenização). Use null/omita o que não foi mencionado.',
              properties: {
                patient: {
                  type: 'string',
                  description: 'Nome ou ID de paciente mencionado.',
                },
                procedure: { type: 'string' },
                hospital: { type: 'string' },
                health_plan: { type: 'string' },
                doctor: { type: 'string' },
                surgery_request_protocol: { type: 'string' },
                priority: {
                  type: 'string',
                  description:
                    'Prioridade em pt-BR ou enum (LOW/MEDIUM/HIGH/URGENT).',
                },
                date_hints: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Datas sugeridas pelo usuário.',
                },
                amount: {
                  type: 'string',
                  description: 'Valor monetário citado.',
                },
                invoice_number: { type: 'string' },
              },
            },
            plan_steps: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Lista curta de etapas que o assistente vai executar (ex.: ["verificar paciente", "verificar procedimento", "pedir prioridade"]).',
            },
          },
          required: ['intent', 'plan_steps'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const intentRaw = String((args as any).intent ?? '').trim();
      const intent = (PLAN_INTENTS as readonly string[]).includes(intentRaw)
        ? intentRaw
        : 'unknown';
      const plan_steps: string[] = Array.isArray((args as any).plan_steps)
        ? (args as any).plan_steps.map((s: unknown) => String(s ?? ''))
        : [];
      const mentioned_entities: Record<string, unknown> =
        (args as any).mentioned_entities &&
        typeof (args as any).mentioned_entities === 'object'
          ? ((args as any).mentioned_entities as Record<string, unknown>)
          : {};

      const draftType = intentToDraftType(intent);
      let draftStarted = false;
      let nextRequiredFields: string[] = [];

      let openedAsSubdraft = false;
      let protectedCreateScActive = false;
      if (draftType && COMPLEX_INTENTS.includes(intent)) {
        const current = await draftService.getCurrent(context.conversationId);
        const subdraftReturnField = SUBDRAFT_RETURN_FIELD[intent];

        // GUARD: enquanto houver `create_sc` ativo, NÃO derrubamos o draft
        // pai para abrir drafts não-relacionados (update_sc, send_sc,
        // invoice, etc.). Esses intents foram historicamente disparados
        // quando o usuário disse coisas como "quero adicionar hospital e
        // convênio" — o LLM rotulava como `update_sc` e o código apagava
        // o `create_sc` em curso. A nova regra:
        //   - Se o intent é um cadastro (paciente/hospital/convênio/
        //     procedimento) → abre como sub-draft (comportamento clássico).
        //   - Se o intent é `create_sc` → retoma o existente (não recria).
        //   - Caso contrário → mantém o `create_sc` e devolve um sinal
        //     `protected_create_sc_active` para o LLM se reorientar.
        if (current && current.type === 'create_sc') {
          if (draftType !== 'create_sc' && subdraftReturnField) {
            await draftService.start({
              conversationId: context.conversationId,
              type: draftType,
              parent: {
                type: current.type,
                returnField: subdraftReturnField,
                snapshot: current,
              },
            });
            draftStarted = true;
            openedAsSubdraft = true;
          } else if (draftType !== 'create_sc') {
            protectedCreateScActive = true;
          }
        } else if (!current || current.type !== draftType) {
          await draftService.start({
            conversationId: context.conversationId,
            type: draftType,
          });
          draftStarted = true;
        }

        const effectiveType = protectedCreateScActive ? 'create_sc' : draftType;
        const validation = await draftService.validate(
          context.conversationId,
          effectiveType,
        );
        nextRequiredFields = validation.missing;
      }

      const data: PlanActionsData = {
        intent,
        draft_type: protectedCreateScActive ? 'create_sc' : draftType,
        draft_started: draftStarted,
        opened_as_subdraft: openedAsSubdraft,
        next_required_fields: nextRequiredFields,
        plan_steps,
        mentioned_entities,
      };
      if (protectedCreateScActive) {
        (data as any).protected_create_sc_active = true;
      }

      const message = protectedCreateScActive
        ? `Há um rascunho de criação de SC ATIVO — NÃO abri o draft "${intent}" para não destruir o trabalho em curso. Continue preenchendo o draft create_sc atual (ex.: usuário pediu hospital/convênio? grave no draft via draft_update). Se o usuário REALMENTE quiser abandonar a criação, peça confirmação e use draft_cancel antes. Próximos campos do create_sc: ${nextRequiredFields.join(', ') || '(nenhum pendente)'}.`
        : draftType && COMPLEX_INTENTS.includes(intent)
          ? draftStarted
            ? `Rascunho de ${labelFor(intent)} iniciado. Próximos campos: ${nextRequiredFields.join(', ') || '(nenhum pendente)'}.`
            : `Rascunho de ${labelFor(intent)} retomado. Próximos campos: ${nextRequiredFields.join(', ') || '(nenhum pendente)'}.`
          : `Intent classificado como "${intent}". Nenhum rascunho necessário; responda diretamente.`;

      return buildToolResult<PlanActionsData>({
        status: 'ok',
        data,
        message,
        nextRequiredFields,
      });
    },
  };

  return [planActions];
}

function labelFor(intent: string): string {
  const map: Record<string, string> = {
    create_sc: 'criação de SC',
    create_patient: 'cadastro de paciente',
    create_hospital: 'cadastro de hospital',
    create_health_plan: 'cadastro de convênio',
    create_procedure: 'cadastro de procedimento',
    invoice: 'faturamento',
    contestation: 'contestação',
    scheduling: 'agendamento',
    update_sc: 'atualização de dados da SC',
    send_sc: 'envio da SC para análise',
    start_analysis: 'início da análise',
    accept_authorization: 'aceite da autorização',
    mark_performed: 'marcação como realizada',
  };
  return map[intent] ?? intent;
}
