import { PiiCategory } from '../services/pii-vault.service';

export const TOOL_PII_ALLOWLIST: Record<string, PiiCategory[]> = {
  query_surgery_requests: ['protocol', 'date'],
  get_pendencies: ['protocol'],
  get_workflow_requirements: [],
  list_post_surgery_required_docs: ['protocol'],
  upload_doctor_signature: [],
  query_patients: ['cpf', 'phone', 'email', 'birth_date'],
  search_procedures: [],
  search_tuss_codes: [],
  search_cid_codes: [],
  list_sc_creation_catalog: [],

  advance_surgery_request: ['protocol'],
  set_has_opme: ['protocol'],
  close_surgery_request: ['protocol'],
  reschedule_surgery: ['protocol', 'date'],
  confirm_receipt: ['protocol', 'date'],
  update_receipt: ['protocol', 'date'],
  manage_report_sections: ['protocol'],

  set_hospital: ['protocol'],
  set_health_plan: ['protocol'],

  manage_tuss_items: ['protocol'],
  manage_opme_items: ['protocol'],
  manage_documents: ['protocol'],
  manage_report_images: ['protocol'],

  attach_document_from_whatsapp: ['protocol'],
  create_patient_from_document: [
    'patient_name',
    'cpf',
    'phone',
    'email',
    'birth_date',
  ],

  sc_draft_set_patient: [],
  sc_draft_set_procedure: [],
  sc_draft_set_hospital: [],
  sc_draft_set_health_plan: [],
  sc_draft_set_doctor: [],
  sc_draft_set_priority: [],
  sc_draft_set_notes: [],
  sc_draft_set_dates: [],
  sc_draft_status: [],
  sc_draft_preview: [],
  sc_draft_commit: ['protocol'],
  sc_draft_cancel: [],

  patient_draft_set_name: [],
  patient_draft_set_phone: [],
  patient_draft_set_email: [],
  patient_draft_set_cpf: [],
  patient_draft_set_birth_date: [],
  patient_draft_set_gender: [],
  patient_draft_preview: [],
  patient_draft_commit: [],
  patient_draft_cancel: [],
  patient_draft_status: [],
  hospital_draft_set_name: [],
  hospital_draft_preview: [],
  hospital_draft_commit: [],
  hospital_draft_cancel: [],
  hospital_draft_status: [],
  health_plan_draft_set_name: [],
  health_plan_draft_preview: [],
  health_plan_draft_commit: [],
  health_plan_draft_cancel: [],
  health_plan_draft_status: [],
  procedure_draft_set_name: [],
  procedure_draft_preview: [],
  procedure_draft_commit: [],
  procedure_draft_cancel: [],
  procedure_draft_status: [],

  invoice_draft_set_request: ['protocol'],
  invoice_draft_set_protocol: [],
  invoice_draft_set_value: [],
  invoice_draft_set_sent_at: [],
  invoice_draft_set_payment_deadline: [],
  invoice_draft_preview: [],
  invoice_draft_commit: ['protocol'],
  invoice_draft_cancel: [],
  invoice_draft_status: [],
  contestation_draft_set_request: ['protocol'],
  contestation_draft_set_type: [],
  contestation_draft_set_reason: [],
  contestation_draft_set_delivery: [],
  contestation_draft_preview: [],
  contestation_draft_commit: ['protocol'],
  contestation_draft_cancel: [],
  contestation_draft_status: [],
  scheduling_draft_set_request: ['protocol'],
  scheduling_draft_set_date_options: ['date'],
  scheduling_draft_set_confirmed_date: ['date'],
  scheduling_draft_preview: [],
  scheduling_draft_commit: ['protocol'],
  scheduling_draft_cancel: [],
  scheduling_draft_status: [],
  update_sc_draft_set_request: ['protocol'],
  update_sc_draft_set_scope: [],
  update_sc_draft_set_field: [],
  update_sc_draft_preview: [],
  update_sc_draft_commit: ['protocol'],
  update_sc_draft_cancel: [],
  update_sc_draft_status: [],

  send_sc_draft_set_request: ['protocol'],
  send_sc_draft_set_method: [],
  send_sc_draft_set_email_fields: ['email'],
  send_sc_draft_preview: [],
  send_sc_draft_commit: ['protocol'],
  send_sc_draft_cancel: [],
  send_sc_draft_status: [],
  start_analysis_draft_set_request: ['protocol'],
  start_analysis_draft_set_request_number: [],
  start_analysis_draft_set_received_at: ['date'],
  start_analysis_draft_set_quotation: ['date'],
  start_analysis_draft_set_notes: [],
  start_analysis_draft_preview: [],
  start_analysis_draft_commit: ['protocol'],
  start_analysis_draft_cancel: [],
  start_analysis_draft_status: [],
  accept_authorization_draft_set_request: ['protocol'],
  accept_authorization_draft_set_date_options: ['date'],
  accept_authorization_draft_preview: [],
  accept_authorization_draft_commit: ['protocol'],
  accept_authorization_draft_cancel: [],
  accept_authorization_draft_status: [],
  mark_performed_draft_set_request: ['protocol'],
  mark_performed_draft_set_performed_at: ['date'],
  mark_performed_draft_check_docs: [],
  mark_performed_draft_preview: [],
  mark_performed_draft_commit: ['protocol'],
  mark_performed_draft_cancel: [],
  mark_performed_draft_status: [],

  plan_actions: [],

  send_notification: ['protocol'],
};

export class PiiAllowlistViolationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly category: PiiCategory,
  ) {
    super(
      `Tool "${toolName}" tentou tokenizar categoria PII não permitida: "${category}".`,
    );
    this.name = 'PiiAllowlistViolationError';
  }
}

export function getAllowedCategoriesForTool(toolName: string): PiiCategory[] {
  return TOOL_PII_ALLOWLIST[toolName] ?? [];
}

export function isCategoryAllowedForTool(
  toolName: string,
  category: PiiCategory,
): boolean {
  return getAllowedCategoriesForTool(toolName).includes(category);
}

export function assertCategoryAllowed(
  toolName: string,
  category: PiiCategory,
): void {
  if (!isCategoryAllowedForTool(toolName, category)) {
    throw new PiiAllowlistViolationError(toolName, category);
  }
}
