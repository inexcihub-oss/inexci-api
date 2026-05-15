import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';

export type WorkflowActionType =
  | 'send_sc'
  | 'start_analysis'
  | 'accept_authorization'
  | 'contest_authorization'
  | 'confirm_date'
  | 'update_date_options'
  | 'reschedule'
  | 'mark_performed'
  | 'invoice_request'
  | 'confirm_receipt'
  | 'contest_payment'
  | 'update_receipt'
  | 'close_surgery_request';

export interface ActorRef {
  userId: string;
  /**
   * Origem da ação. `whatsapp` indica que veio do orchestrator de IA;
   * `dashboard` é o frontend humano. Útil para auditoria e telemetria
   * (`ai_token_usage_log.tools_invoked`).
   */
  origin: 'whatsapp' | 'dashboard' | 'system';
}

export interface WorkflowAction<TPayload = Record<string, unknown>> {
  type: WorkflowActionType;
  surgeryRequestId: string;
  payload: TPayload;
  actor: ActorRef;
}

export type DomainEventName =
  | 'sc.sent'
  | 'sc.analysis_started'
  | 'sc.authorized'
  | 'sc.contested'
  | 'sc.scheduled'
  | 'sc.rescheduled'
  | 'sc.performed'
  | 'sc.invoiced'
  | 'sc.payment_received'
  | 'sc.payment_contested'
  | 'sc.closed';

export interface DomainEvent {
  name: DomainEventName;
  surgeryRequestId: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface WorkflowResult {
  status: 'ok' | 'blocked' | 'error';
  newStatus?: SurgeryRequestStatus;
  pendencies?: string[];
  events: DomainEvent[];
  /** Mensagem legível para a UI/LLM. */
  summary: string;
}
