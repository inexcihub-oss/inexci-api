import { OperationDraftType } from '../drafts/operation-draft.types';

/**
 * Intent canônico do planner. Cobre o set de operações que o orchestrator
 * pode rotear; intents desconhecidas viram `out_of_scope`.
 */
export type PlannerIntent =
  | 'create_sc'
  | 'send_sc'
  | 'start_analysis'
  | 'accept_authorization'
  | 'mark_performed'
  | 'scheduling'
  | 'invoice'
  | 'contestation'
  | 'update_sc'
  | 'create_patient'
  | 'create_hospital'
  | 'create_health_plan'
  | 'create_procedure'
  | 'query_sc'
  | 'query_patient'
  | 'query_workflow'
  | 'attach_document'
  | 'upload_signature'
  | 'cancel'
  | 'confirm'
  | 'numeric_choice'
  | 'smalltalk'
  | 'help'
  | 'out_of_scope'
  | 'unknown';

export type PlannerRisk = 'low' | 'medium' | 'high';

export type PlannerFallbackStrategy =
  | 'ask_user'
  | 'search_catalog'
  | 'use_premium_tier'
  | 'noop';

export interface PlannerEntities {
  patient_ref?: string | null;
  hospital_ref?: string | null;
  health_plan_ref?: string | null;
  doctor_ref?: string | null;
  tuss_hint?: string[];
  cid_hint?: string[];
  date_hint?: string | null;
  monetary_value_hint?: number | null;
  surgery_request_ref?: string | null;
}

/**
 * Output canônico do planner (Fase 3 do Blueprint v3).
 * Usado tanto pelo `DeterministicIntentClassifier` (regex/keywords) quanto
 * pelo `PlannerLLM` (cheap tier com structured output).
 */
export interface PlanResult {
  intent: PlannerIntent;
  /** Confiança 0..1 — usado pelo gate de fallback p/ LLM. */
  confidence: number;
  /** Esta turn continua um workflow já ativo? */
  active_workflow_continuation: boolean;
  /** Workflow ativo (espelha `OperationalState.activeWorkflow.name`). */
  active_workflow: OperationDraftType | null;
  entities: PlannerEntities;
  /** Tools sugeridas, ordem indica preferência. */
  next_tool_candidates: string[];
  /** Campos faltantes do draft (vem do operational state, não do LLM). */
  missing_fields: string[];
  risk: PlannerRisk;
  needs_clarification: boolean;
  fallback_strategy: PlannerFallbackStrategy;
  /** Source — auditoria do estágio de origem. */
  source: 'deterministic' | 'llm' | 'hybrid' | 'fallback';
}
