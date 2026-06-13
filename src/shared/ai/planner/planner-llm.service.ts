import { Injectable, Logger } from '@nestjs/common';
import { ModelGatewayService } from '../gateway/model-gateway.service';
import { OperationalState } from '../state/operational-state.types';
import { PlanResult, PlannerIntent } from './planner.types';

/**
 * Schema strict do output do PlannerLLM. Compatível com `response_format`
 * do `chat.completions.create` (json_schema strict).
 */
const PLANNER_RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'PlannerOutput',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'intent',
        'confidence',
        'entities',
        'next_tool_candidates',
        'risk',
        'needs_clarification',
      ],
      properties: {
        intent: {
          type: 'string',
          enum: [
            'create_sc',
            'send_sc',
            'start_analysis',
            'accept_authorization',
            'mark_performed',
            'scheduling',
            'invoice',
            'contestation',
            'update_sc',
            'create_patient',
            'create_hospital',
            'create_health_plan',
            'create_procedure',
            'query_sc',
            'query_patient',
            'query_workflow',
            'attach_document',
            'upload_signature',
            'cancel',
            'confirm',
            'numeric_choice',
            'smalltalk',
            'help',
            'out_of_scope',
            'unknown',
          ],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        entities: {
          type: 'object',
          additionalProperties: false,
          properties: {
            patient_ref: { type: ['string', 'null'] },
            hospital_ref: { type: ['string', 'null'] },
            health_plan_ref: { type: ['string', 'null'] },
            doctor_ref: { type: ['string', 'null'] },
            tuss_hint: { type: 'array', items: { type: 'string' } },
            cid_hint: { type: 'array', items: { type: 'string' } },
            date_hint: { type: ['string', 'null'] },
            monetary_value_hint: { type: ['number', 'null'] },
            surgery_request_ref: { type: ['string', 'null'] },
          },
          required: [
            'patient_ref',
            'hospital_ref',
            'health_plan_ref',
            'doctor_ref',
            'tuss_hint',
            'cid_hint',
            'date_hint',
            'monetary_value_hint',
            'surgery_request_ref',
          ],
        },
        next_tool_candidates: {
          type: 'array',
          items: { type: 'string' },
        },
        risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        needs_clarification: { type: 'boolean' },
      },
    },
  },
} as const;

const PLANNER_SYSTEM_PROMPT = `Você é o planner determinístico do assistente Inexci.
Seu único trabalho: classificar a intenção do usuário e propor próximas tools.

REGRAS:
- Devolva STRICT JSON conforme o schema (campos extras proibidos).
- Não invente IDs nem códigos. Se o usuário citou "Maria Silva", coloque em entities.patient_ref como string crua.
- Quando o usuário responde a um workflow ativo, mantenha intent coerente com o draft.
- "sim/ok/confirmo" → intent="confirm" se houver pending; senão "smalltalk".
- Dígito 1-3 → intent="numeric_choice" se houver opções listadas.
- Mensagens curtas/saudação → "smalltalk".
- Tema fora do escopo Inexci (gestão de SC) → "out_of_scope".
`;

@Injectable()
export class PlannerLlmService {
  private readonly logger = new Logger(PlannerLlmService.name);

  constructor(private readonly modelGateway: ModelGatewayService) {}

  async plan(input: {
    text: string;
    state: OperationalState;
    /** Para tracing: quem disparou o planner. */
    reason: 'low_confidence_deterministic' | 'risk_medium_or_high' | 'forced';
  }): Promise<PlanResult> {
    const userPayload = {
      text: input.text,
      operational_state: {
        active_workflow: input.state.activeWorkflow?.name ?? null,
        fields_pending: input.state.activeWorkflow?.fieldsPending ?? [],
        pending_confirmation_tool: input.state.pendingConfirmation?.tool ?? null,
        numeric_options: input.state.numericChoice?.options ?? [],
        doc_pending_kind: input.state.multimodalContext.docPending?.classifierKind ?? null,
        audio_summary:
          input.state.multimodalContext.audioPending?.summary ?? null,
      },
    };

    try {
      const response = await this.modelGateway.complete({
        tier: 'cheap',
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        temperature: 0,
        responseFormat: PLANNER_RESPONSE_SCHEMA as any,
        cacheKey: `inexci:planner:v1`,
      });

      const content = response.raw.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content) as Partial<PlanResult>;

      return {
        intent: (parsed.intent as PlannerIntent) ?? 'unknown',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        active_workflow_continuation: !!input.state.activeWorkflow,
        active_workflow: input.state.activeWorkflow?.name ?? null,
        entities: parsed.entities ?? {},
        next_tool_candidates: parsed.next_tool_candidates ?? [],
        missing_fields: input.state.activeWorkflow?.fieldsPending ?? [],
        risk: parsed.risk ?? 'medium',
        needs_clarification: parsed.needs_clarification ?? false,
        fallback_strategy: parsed.needs_clarification ? 'ask_user' : 'noop',
        source: 'llm',
      };
    } catch (err: any) {
      this.logger.warn(
        `[PLANNER_LLM] falha (${input.reason}): ${err?.message || err}`,
      );
      return {
        intent: 'unknown',
        confidence: 0,
        active_workflow_continuation: !!input.state.activeWorkflow,
        active_workflow: input.state.activeWorkflow?.name ?? null,
        entities: {},
        next_tool_candidates: [],
        missing_fields: input.state.activeWorkflow?.fieldsPending ?? [],
        risk: 'medium',
        needs_clarification: true,
        fallback_strategy: 'ask_user',
        source: 'fallback',
      };
    }
  }
}
