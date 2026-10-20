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

  sc_draft_preview: [],
  sc_draft_commit: ['protocol'],
  patient_draft_preview: [],
  patient_draft_commit: [],
  hospital_draft_preview: [],
  hospital_draft_commit: [],
  health_plan_draft_preview: [],
  health_plan_draft_commit: [],
  procedure_draft_preview: [],
  procedure_draft_commit: [],

  invoice_draft_preview: [],
  invoice_draft_commit: ['protocol'],
  contestation_draft_preview: [],
  contestation_draft_commit: ['protocol'],
  scheduling_draft_preview: [],
  scheduling_draft_commit: ['protocol'],
  update_sc_draft_preview: [],
  update_sc_draft_commit: ['protocol'],

  send_sc_draft_preview: [],
  send_sc_draft_commit: ['protocol'],
  start_analysis_draft_preview: [],
  start_analysis_draft_commit: ['protocol'],
  accept_authorization_draft_preview: [],
  accept_authorization_draft_commit: ['protocol'],
  mark_performed_draft_check_docs: [],
  mark_performed_draft_preview: [],
  mark_performed_draft_commit: ['protocol'],

  draft_update: ['cpf', 'phone', 'email', 'birth_date'],
  draft_status: ['cpf', 'phone', 'email', 'birth_date'],
  draft_cancel: [],

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

export function isCategoryAllowedForTool(
  toolName: string,
  category: PiiCategory,
): boolean {
  return (TOOL_PII_ALLOWLIST[toolName] ?? []).includes(category);
}
