/** Chaves de documentos utilizadas no sistema */
export const DOCUMENT_KEYS = {
  /** Imagens de exames anexadas ao laudo PDF */
  REPORT_IMAGES: 'report_images',
  /** Pedido médico (solicitação cirúrgica) */
  DOCTOR_REQUEST: 'doctorRequest',
} as const;

export type DocumentKey = (typeof DOCUMENT_KEYS)[keyof typeof DOCUMENT_KEYS];
