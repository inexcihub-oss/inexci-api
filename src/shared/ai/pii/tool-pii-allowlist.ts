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
  get_surgery_request_status: ['protocol', 'date'],
  list_surgery_requests: ['protocol'],
  get_pendencies: ['protocol'],
  // Apenas configuração estática (PENDENCIES_CONFIG) — nenhuma PII envolvida.
  get_workflow_requirements: [],
  // Tokeniza apenas o protocolo da SC; a tool só lê tipos/nomes técnicos
  // de documentos (lista canônica em post-surgery-documents.config.ts).
  list_post_surgery_required_docs: ['protocol'],
  // Não expõe nenhum dado pessoal: a assinatura é binária (imagem) e a
  // resposta para o usuário é só uma confirmação textual.
  upload_doctor_signature: [],
  // Nomes de paciente/médico/hospital/convênio NÃO são mais tokenizados em
  // saídas de tools de lookup — são dados de negócio do próprio owner_id
  // (não PII de terceiro). Continuamos tokenizando CPF/telefone/email/data.
  get_patient_info: ['cpf', 'phone', 'email', 'birth_date'],
  list_patients: ['phone'],
  create_patient: ['patient_name', 'cpf', 'phone', 'email', 'birth_date'],
  // Tools dedicadas para cadastro do catálogo de SC (substituíram a antiga
  // `create_sc_catalog_record`). Cada uma tokeniza apenas a categoria
  // estritamente necessária ao seu preview/retorno.
  create_hospital: ['hospital_name'],
  create_health_plan: ['health_plan_name'],
  create_procedure: [],
  search_procedures: [],
  // Catálogo é puramente leitura: nomes de paciente/médico/hospital/convênio
  // em claro permitem que o LLM identifique matches por similaridade.
  list_sc_creation_catalog: [],

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
  set_hospital: ['protocol'],
  set_health_plan: ['protocol'],

  // ---------- Gestão consolidada (list/add/update/remove ou list/attach/remove) ----------
  manage_tuss_items: ['protocol'],
  manage_opme_items: ['protocol'],
  manage_documents: ['protocol'],
  manage_report_images: ['protocol'],

  // Conteúdo clínico longo NÃO ecoa para a IA: apenas placeholders genéricos.
  update_request_clinical_data: ['protocol'],
  update_request_admin_data: ['protocol'],

  create_surgery_request_from_whatsapp: ['protocol'],

  // ---------- OCR de documentos no WhatsApp (Sprint 3 do plano OCR) ----------
  // attach: só ID/protocolo da SC. Os dados do documento já vivem no storage
  // e no `documents` — a tool não tokeniza nenhum conteúdo do paciente.
  attach_document_from_whatsapp: ['protocol'],
  // create_patient_from_document espelha a allowlist de `create_patient`:
  // o usuário fornece dados pessoais para cadastro e a tool só ecoa de volta
  // o nome do paciente (tokenizado).
  create_patient_from_document: [
    'patient_name',
    'cpf',
    'phone',
    'email',
    'birth_date',
  ],

  // ---------- Draft de criação de SC (Fase 3) ----------
  // Tools de draft expõem apenas `protocol` quando ecoam o resultado final.
  // Nomes (paciente/médico/hospital/convênio) ficam em claro porque o LLM
  // precisa enxergá-los para fazer matching por similaridade.
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

  // ---------- Drafts de cadastros (Fase 4) ----------
  // Tools internas que orquestram cadastros estruturados (paciente, hospital,
  // convênio, procedimento). Não tokenizam nada porque o LLM precisa ver o
  // nome em claro para fazer preview e similaridade. Dados sensíveis do
  // paciente (CPF/telefone/email/nascimento) ficam apenas no draft e
  // nunca são ecoados como resposta da tool — só aparecem no preview
  // textual gerado pelo `OperationDraftService.getPreview`.
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

  // ---------- Drafts dos demais fluxos complexos (Fase 5) ----------
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

  // ---------- Drafts de transição de status (Fase 6.5) ----------
  // Cobrem PENDING→SENT, SENT→IN_ANALYSIS, IN_ANALYSIS→IN_SCHEDULING e
  // SCHEDULED→PERFORMED, exigindo os mesmos campos dos modais do frontend.
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

  // ---------- Plan tool ----------
  plan_actions: [],

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
