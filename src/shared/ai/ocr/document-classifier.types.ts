export type DocumentClassificationKind =
  | 'surgery_request'
  | 'medical_report'
  | 'identity_document'
  | 'authorization_guide'
  | 'exam_report'
  | 'invoice'
  | 'receipt'
  | 'unknown';

export type DocumentClassificationIntent =
  | 'attach'
  | 'create_sc'
  | 'create_patient';

export interface DocumentClassificationPatient {
  name?: string;
  cpf?: string;
  birthDate?: string;
  rg?: string;
  motherName?: string;
  address?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
}

export interface DocumentClassificationHealthPlan {
  name?: string;
  planId?: string;
  validity?: string;
}

export interface DocumentClassificationTussItem {
  code: string;
  description: string;
  qty?: number;
}

export interface DocumentClassificationCidItem {
  code: string;
}

export interface DocumentClassificationOpmeItem {
  description: string;
  qty: number;
  supplier?: string;
  manufacturer?: string;
}

export interface DocumentClassificationReportSection {
  title: string;
  description: string;
}

export interface DocumentClassificationExtracted {
  patient?: DocumentClassificationPatient;
  hospital?: string;
  healthPlan?: DocumentClassificationHealthPlan;
  tuss?: DocumentClassificationTussItem[];
  cid?: DocumentClassificationCidItem[];
  opme?: DocumentClassificationOpmeItem[];
  suggestedSuppliers?: string[];
  diagnosis?: string;
  suggestedProcedureName?: string;
  reportSections?: DocumentClassificationReportSection[];
  laudoText?: string;
  notes?: string;
}

export interface DocumentClassification {
  kind: DocumentClassificationKind;
  confidence: number;
  extracted: DocumentClassificationExtracted;
  suggestedDocumentType: string;
  ambiguity?: string;
  durationMs: number;
  model: string;
}
