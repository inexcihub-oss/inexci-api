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
  notes?: string | null;
  tussItems?: Array<{
    code: string;
    description?: string;
  }>;
  opmeItems?: Array<{
    description: string;
    qty?: number;
    supplier?: string;
    manufacturer?: string;
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
  dateOptions?: string[];
  confirmedDateIndex?: number;
  confirmedDate?: string;
}

export interface UpdateScDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  scope?: 'clinical' | 'admin' | 'patient';
  changes?: Record<string, unknown>;
}

export interface SendScDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  method?: 'email' | 'download';
  to?: string;
  subject?: string;
  message?: string;
  notifyPatient?: boolean;
  attachments?: string[];
}

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

export interface AcceptAuthorizationDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  dateOptions?: string[];
  notifyPatient?: boolean;
}

export interface MarkPerformedDraftFields {
  surgeryRequestId?: string;
  surgeryRequestLabel?: string;
  surgeryPerformedAt?: string;
  notifyPatient?: boolean;
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
  parent?: {
    type: OperationDraftType;
    returnField: string;
    snapshot: unknown;
  };
}

export const REQUIRED_FIELDS_BY_TYPE: Record<OperationDraftType, string[]> = {
  create_sc: ['patientId', 'doctorId', 'procedureId', 'priority'],
  create_patient: ['name', 'cpf'],
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
