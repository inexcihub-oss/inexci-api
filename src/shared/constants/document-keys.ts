/** Chaves de documentos utilizadas no sistema */
export const DOCUMENT_KEYS = {
  /** Imagens de exames anexadas ao laudo PDF */
  REPORT_IMAGES: 'report_images',
  /** Pedido médico (solicitação cirúrgica) */
  DOCTOR_REQUEST: 'doctorRequest',
  /** Documento enviado na criação da SC via fluxo "nova-via-documento" (não entra no PDF exportado) */
  SC_CREATION_SOURCE: 'sc_creation_source',
} as const;

/** Documentos que não devem ser mesclados ao PDF exportado da solicitação */
export const PDF_EXCLUDED_DOCUMENT_KEYS: readonly string[] = [
  DOCUMENT_KEYS.REPORT_IMAGES,
  DOCUMENT_KEYS.SC_CREATION_SOURCE,
];

export type DocumentKey = (typeof DOCUMENT_KEYS)[keyof typeof DOCUMENT_KEYS];
