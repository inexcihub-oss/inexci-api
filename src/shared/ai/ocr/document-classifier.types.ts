/**
 * Tipos de documento que o classificador reconhece. Mantemos esse enum
 * separado dos `DOCUMENT_TYPES` (constants) porque aqui é o "rótulo
 * conceitual" (ex.: `medical_report`, `identity_document`); as tools
 * posteriormente mapeiam para o `DOCUMENT_TYPES` correto na hora de
 * persistir.
 */
export type DocumentClassificationKind =
  | 'surgery_request'
  | 'medical_report'
  | 'identity_document'
  | 'authorization_guide'
  | 'exam_report'
  | 'invoice'
  | 'receipt'
  | 'unknown';

/**
 * Hint opcional vindo do intent reconhecido pelo dispatcher
 * (`attach`, `create_sc`, `create_patient`). Influencia o prompt mas o
 * classificador é livre para decidir o `kind` e devolver os dados extraídos
 * que conseguir identificar — nada é "forçado".
 */
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
}

export interface DocumentClassificationCidItem {
  code: string;
}

export interface DocumentClassificationOpmeItem {
  description: string;
  qty: number;
}

export interface DocumentClassificationExtracted {
  patient?: DocumentClassificationPatient;
  hospital?: string;
  healthPlan?: DocumentClassificationHealthPlan;
  tuss?: DocumentClassificationTussItem[];
  cid?: DocumentClassificationCidItem[];
  opme?: DocumentClassificationOpmeItem[];
  laudoText?: string;
  doctorCRM?: string;
  notes?: string;
}

export interface DocumentClassification {
  kind: DocumentClassificationKind;
  /** 0..1 — abaixo de 0.7 o `ambiguity` deve descrever a dúvida. */
  confidence: number;
  extracted: DocumentClassificationExtracted;
  /** Mapeia para `DOCUMENT_TYPES` (ex.: `medical_report`, `personal_document`). */
  suggestedDocumentType: string;
  /** Texto livre quando `confidence < 0.7`. */
  ambiguity?: string;
  /** Latência em ms da chamada ao LLM. */
  durationMs: number;
  /** Modelo efetivamente usado (para auditoria/observabilidade). */
  model: string;
}
