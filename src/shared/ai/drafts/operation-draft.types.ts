/**
 * Tipos discriminados de Operation Draft. Cada tipo corresponde a um fluxo
 * complexo (múltiplos campos) que a IA do WhatsApp pode conduzir:
 * a IA preenche campos em qualquer ordem via tools `*_draft_set_*`,
 * o service valida, gera preview e ao confirmar dispara o commit.
 */
export type OperationDraftType =
  | 'create_sc'
  | 'create_patient'
  | 'create_hospital'
  | 'create_health_plan'
  | 'create_procedure'
  | 'invoice'
  | 'contestation'
  | 'scheduling'
  | 'update_sc'
  | 'send_sc'
  | 'start_analysis'
  | 'accept_authorization'
  | 'mark_performed';

export type OperationDraftStatus =
  | 'collecting'
  | 'ready'
  | 'pending_confirmation'
  | 'committing';

export interface CreateScDraftFields {
  patientId?: string;
  patientLabel?: string;
  doctorId?: string;
  doctorLabel?: string;
  procedureId?: string;
  procedureLabel?: string;
  hospitalId?: string | null;
  hospitalLabel?: string | null;
  healthPlanId?: string | null;
  healthPlanLabel?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  preferredDates?: string[];
  /**
   * Texto do laudo. Quando preenchido, `sc_draft_commit` cria
   * automaticamente uma `report_section` na SC com este conteúdo.
   */
  notes?: string | null;
  /**
   * Itens TUSS a serem gravados na SC logo após a criação. Vêm
   * tipicamente do classificador de documento ou de `search_tuss_codes`.
   * Cada item precisa de `code` (TUSS oficial); `description` é opcional
   * (a tool resolve no catálogo se faltar).
   */
  tussItems?: Array<{
    code: string;
    description?: string;
  }>;
  /**
   * Itens OPME a serem gravados na SC logo após a criação. Vêm
   * tipicamente do classificador de documento ou de uma interação
   * dedicada. `description` é obrigatório; `qty` default 1.
   */
  opmeItems?: Array<{
    description: string;
    qty?: number;
    supplier?: string;
    brand?: string;
  }>;
}

export interface CreatePatientDraftFields {
  name?: string;
  cpf?: string | null;
  phone?: string;
  email?: string | null;
  birthDate?: string | null;
  gender?: 'M' | 'F' | 'O' | null;
  doctorId?: string;
  doctorLabel?: string;
}

export interface CreateHospitalDraftFields {
  name?: string;
}

export interface CreateHealthPlanDraftFields {
  name?: string;
}

export interface CreateProcedureDraftFields {
  name?: string;
}

export interface InvoiceDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  invoiceProtocol?: string;
  invoiceValue?: number;
  invoiceSentAt?: string;
  paymentDeadline?: string | null;
  setAsDefaultForHealthPlan?: boolean;
  notes?: string | null;
}

export interface ContestationDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  contestationType?: 'AUTHORIZATION' | 'PAYMENT';
  reason?: string;
  /** Apenas AUTHORIZATION: método de envio. */
  method?: 'email' | 'download' | 'document';
  to?: string;
  subject?: string;
  message?: string;
  attachments?: string[];
  notes?: string | null;
}

export interface SchedulingDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  /**
   * Quando o agendamento exige sugerir opções (status IN_SCHEDULING),
   * preenche `dateOptions` com 1 a 3 datas.
   */
  dateOptions?: string[];
  /**
   * Quando o paciente/usuário confirma uma das opções, `confirmedDateIndex`
   * indica qual (0, 1, 2) e `confirmedDate` espelha a data escolhida.
   */
  confirmedDateIndex?: number;
  confirmedDate?: string;
}

export interface UpdateScDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  scope?: 'clinical' | 'admin' | 'patient';
  /**
   * Alterações estruturadas: chave = nome do campo da entidade
   * (diagnosis, medicalReport, priority, healthPlanProtocol, etc.) e
   * valor = novo valor.
   */
  changes?: Record<string, unknown>;
}

/**
 * Draft do fluxo de ENVIO (PENDING → SENT).
 *
 * Antes de commit, o service valida via `pendencyValidator` que o checklist
 * obrigatório está completo (hospital, TUSS, OPME, laudo).
 */
export interface SendScDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  method?: 'email' | 'download';
  /** Quando `method = 'email'`: destinatários separados por `;`. */
  to?: string;
  subject?: string;
  message?: string;
  notifyPatient?: boolean;
  /**
   * Quando `method = 'email'`: IDs de documentos da SC (`documents.id`)
   * que devem ser anexados ao e-mail ALÉM do PDF da SC (gerado
   * automaticamente). O backend resolve cada ID para `documents.filePath`,
   * baixa do Storage e anexa ao envio.
   */
  attachments?: string[];
}

/**
 * Draft do fluxo de INÍCIO DE ANÁLISE (SENT → IN_ANALYSIS).
 *
 * Reflete o `StartAnalysisModal`: nº de protocolo da operadora, data de
 * recebimento e até 3 cotações opcionais.
 */
export interface StartAnalysisDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  requestNumber?: string;
  receivedAt?: string;
  quotation1Number?: string | null;
  quotation1ReceivedAt?: string | null;
  quotation2Number?: string | null;
  quotation2ReceivedAt?: string | null;
  quotation3Number?: string | null;
  quotation3ReceivedAt?: string | null;
  notes?: string | null;
  notifyPatient?: boolean;
}

/**
 * Draft do fluxo de ACEITE DE AUTORIZAÇÃO (IN_ANALYSIS → IN_SCHEDULING).
 *
 * Reflete o `UpdateAuthorizationsModal`: o usuário aceita a autorização do
 * convênio e cadastra de 1 a 3 datas propostas para a cirurgia.
 */
export interface AcceptAuthorizationDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  /** Entre 1 e 3 datas (ISO). */
  dateOptions?: string[];
  notifyPatient?: boolean;
}

/**
 * Draft do fluxo de MARCAÇÃO DE REALIZADA (SCHEDULED → PERFORMED).
 *
 * Reflete o `SurgeryStatusModal`: o usuário confirma a data de realização e
 * o draft só pode ser commitado quando os documentos pós-cirúrgicos
 * obrigatórios estiverem anexados na solicitação.
 */
export interface MarkPerformedDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  surgeryPerformedAt?: string;
}

export type DraftFieldsByType = {
  create_sc: CreateScDraftFields;
  create_patient: CreatePatientDraftFields;
  create_hospital: CreateHospitalDraftFields;
  create_health_plan: CreateHealthPlanDraftFields;
  create_procedure: CreateProcedureDraftFields;
  invoice: InvoiceDraftFields;
  contestation: ContestationDraftFields;
  scheduling: SchedulingDraftFields;
  update_sc: UpdateScDraftFields;
  send_sc: SendScDraftFields;
  start_analysis: StartAnalysisDraftFields;
  accept_authorization: AcceptAuthorizationDraftFields;
  mark_performed: MarkPerformedDraftFields;
};

export interface OperationDraft<
  T extends OperationDraftType = OperationDraftType,
> {
  type: T;
  startedAt: string;
  updatedAt: string;
  status: OperationDraftStatus;
  fields: DraftFieldsByType[T];
  /**
   * Quando este draft foi aberto como sub-draft (ex.: `create_patient` aberto
   * dentro de um `create_sc`), `parent` aponta de volta para o pai.
   */
  parent?: {
    type: OperationDraftType;
    returnField: string;
    snapshot: unknown;
  };
}

/**
 * Lista de campos obrigatórios por tipo de draft. Usada por
 * `OperationDraftService.validate` para decidir se o draft está pronto.
 */
export const REQUIRED_FIELDS_BY_TYPE: Record<OperationDraftType, string[]> = {
  create_sc: ['patientId', 'doctorId', 'procedureId', 'priority'],
  create_patient: ['name', 'phone'],
  create_hospital: ['name'],
  create_health_plan: ['name'],
  create_procedure: ['name'],
  invoice: [
    'surgeryRequestId',
    'invoiceProtocol',
    'invoiceValue',
    'invoiceSentAt',
  ],
  contestation: ['surgeryRequestId', 'contestationType', 'reason'],
  scheduling: ['surgeryRequestId'],
  update_sc: ['surgeryRequestId', 'scope', 'changes'],
  send_sc: ['surgeryRequestId', 'method'],
  start_analysis: ['surgeryRequestId', 'requestNumber', 'receivedAt'],
  accept_authorization: ['surgeryRequestId', 'dateOptions'],
  mark_performed: ['surgeryRequestId', 'surgeryPerformedAt'],
};

/**
 * Rótulo amigável em pt-BR de cada tipo de draft, usado em previews.
 */
export const DRAFT_TYPE_LABELS: Record<OperationDraftType, string> = {
  create_sc: 'Criação de solicitação cirúrgica',
  create_patient: 'Cadastro de paciente',
  create_hospital: 'Cadastro de hospital',
  create_health_plan: 'Cadastro de convênio',
  create_procedure: 'Cadastro de procedimento',
  invoice: 'Faturamento',
  contestation: 'Contestação',
  scheduling: 'Agendamento',
  update_sc: 'Atualização de dados da SC',
  send_sc: 'Envio da solicitação para análise',
  start_analysis: 'Início da análise pela operadora',
  accept_authorization: 'Aceite da autorização do convênio',
  mark_performed: 'Marcação de cirurgia como realizada',
};

/**
 * Mapa de "intent" (vinda da tool `plan_actions`) → tipo de draft.
 * Intents diferentes podem mapear para o mesmo tipo (ex.: `update_sc_clinical`,
 * `update_sc_admin` ambos viram `update_sc` com escopo diferente).
 */
export function intentToDraftType(intent: string): OperationDraftType | null {
  switch (intent) {
    case 'create_sc':
      return 'create_sc';
    case 'create_patient':
      return 'create_patient';
    case 'create_hospital':
      return 'create_hospital';
    case 'create_health_plan':
      return 'create_health_plan';
    case 'create_procedure':
      return 'create_procedure';
    case 'invoice':
      return 'invoice';
    case 'contestation':
      return 'contestation';
    case 'scheduling':
      return 'scheduling';
    case 'update_sc':
      return 'update_sc';
    case 'send_sc':
      return 'send_sc';
    case 'start_analysis':
      return 'start_analysis';
    case 'accept_authorization':
      return 'accept_authorization';
    case 'mark_performed':
      return 'mark_performed';
    default:
      return null;
  }
}

/**
 * Conjunto de intents que disparam fluxo complexo (precisam de draft +
 * plan_actions). `read_only`, `smalltalk` e `unknown` ficam fora.
 */
export const COMPLEX_INTENTS: ReadonlyArray<string> = [
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
];
