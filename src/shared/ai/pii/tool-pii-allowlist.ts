import { PiiCategory } from '../services/pii-vault.service';

/**
 * Allowlist por tool: declara quais categorias de PII cada tool tem permissão de
 * tokenizar e devolver para o LLM externo.
 *
 * Regras:
 * - Lista vazia (`[]`) = a tool NÃO pode tokenizar nenhuma PII (apenas dados não pessoais).
 * - `protocol` é considerado pseudo-identificador interno; toda tool que opera em SC pode listá-lo.
 * - Conteúdo clínico longo (`medical_report`, `patient_history`, `diagnosis`, `surgery_description`)
 *   NUNCA aparece em tool de leitura — só em mutações que já recebem `payload_blob`.
 * - Quando uma tool precisa expor identificadores pessoais (nome, hospital, convênio etc.),
 *   declarar explicitamente aqui.
 */
export const TOOL_PII_ALLOWLIST: Record<string, PiiCategory[]> = {
  // ---------- Leitura ----------
  get_surgery_request_status: [
    'protocol',
    'patient_name',
    'hospital_name',
    'health_plan_name',
    'date',
  ],
  list_surgery_requests: ['protocol', 'patient_name'],
  get_documents: ['protocol'],
  get_opme_items: ['protocol'],
  get_pendencies: ['protocol'],
  get_patient_info: ['patient_name', 'cpf', 'phone', 'email', 'birth_date'],
  create_patient: ['patient_name', 'cpf', 'phone', 'email', 'birth_date'],
  list_sc_creation_catalog: [
    'patient_name',
    'hospital_name',
    'health_plan_name',
    'doctor_name',
  ],

  // ---------- Mutação: workflow ----------
  advance_surgery_request: ['protocol'],
  set_has_opme: ['protocol'],
  close_surgery_request: ['protocol'],
  confirm_date: ['protocol', 'date'],
  update_date_options: ['protocol', 'date'],
  reschedule_surgery: ['protocol', 'date'],
  mark_performed: ['protocol', 'date'],
  invoice_request: ['protocol'],
  confirm_receipt: ['protocol', 'date'],
  contest_authorization_full: ['protocol'],
  contest_payment: ['protocol'],
  update_receipt: ['protocol', 'date'],
  manage_report_sections: ['protocol'],

  // ---------- Mutação: dados ----------
  update_surgery_request_data: ['protocol'],
  update_patient_data: ['protocol'],
  set_hospital: ['protocol', 'hospital_name'],
  add_tuss_item: ['protocol'],
  add_opme_item: ['protocol'],

  // Conteúdo clínico longo NÃO ecoa para a IA: apenas placeholders genéricos.
  update_request_clinical_data: ['protocol'],
  update_request_admin_data: ['protocol'],

  attach_document_from_whatsapp: ['protocol'],
  create_sc_catalog_record: [
    'patient_name',
    'hospital_name',
    'health_plan_name',
    'doctor_name',
  ],
  create_surgery_request_from_whatsapp: [
    'protocol',
    'patient_name',
    'hospital_name',
    'health_plan_name',
    'doctor_name',
  ],

  // ---------- Notificação ----------
  send_notification: ['protocol'],
};

/**
 * Lança erro quando a tool tenta tokenizar uma categoria fora do escopo permitido.
 * Use no início de cada tool para garantir contrato pelo código (não só pela revisão).
 */
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
