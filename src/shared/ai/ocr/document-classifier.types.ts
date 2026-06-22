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
  /**
   * Fornecedor/distribuidor sugerido (ex.: `SINTEX`, `VITALITY`, `GUSMED`)
   * — laudos brasileiros costumam listar isso após "SUGIRO AS EMPRESAS:".
   */
  supplier?: string;
  /**
   * Marca/fabricante (ex.: `DIVA/NOVA SPINE`, `ROI-C / HIGHRIDGE MEDICAL`)
   * — em geral aparece entre parênteses, ao lado do fornecedor.
   */
  manufacturer?: string;
}

export interface DocumentClassificationExtracted {
  patient?: DocumentClassificationPatient;
  hospital?: string;
  healthPlan?: DocumentClassificationHealthPlan;
  tuss?: DocumentClassificationTussItem[];
  cid?: DocumentClassificationCidItem[];
  opme?: DocumentClassificationOpmeItem[];
  /**
   * Lista geral de fornecedores sugeridos no documento, quando o laudo
   * agrupa empresas em vez de associar 1:1 com cada material. Ex.:
   * ["SINTEX", "VITALITY", "GUSMED"].
   */
  suggestedSuppliers?: string[];
  /**
   * Diagnóstico clínico em texto livre (ex.: "Hérnia discal cervical
   * médio-foraminal C5-C6 e C4-C5 com compressão radicular e medular").
   * Pode ser usado para sugerir CID e popular `surgery_request.notes`.
   */
  diagnosis?: string;
  /**
   * Nome do procedimento sugerido pelo médico no documento, em texto livre
   * (ex.: "Artrodese cervical anterior C5-C6 e C4-C5"). Não é o código TUSS:
   * é o nome do procedimento cirúrgico. Usado para sugerir o `procedure_name`
   * ao popular o draft de SC.
   */
  suggestedProcedureName?: string;
  laudoText?: string;
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
