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
  | 'update_sc';

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
  notes?: string | null;
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
];
