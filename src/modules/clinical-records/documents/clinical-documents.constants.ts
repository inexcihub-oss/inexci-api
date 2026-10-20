import DOCUMENT_TYPES from 'src/common/document-types.common';

export const TIPOS_DOCUMENTO_EMITIDO: readonly string[] = [
  DOCUMENT_TYPES.prescription,
  DOCUMENT_TYPES.medicalCertificate,
  DOCUMENT_TYPES.examReferral,
];

export function isDocumentoEmitido(documento: {
  key: string;
  clinicalRecordId: string | null;
}): boolean {
  return (
    !!documento.clinicalRecordId &&
    TIPOS_DOCUMENTO_EMITIDO.includes(documento.key)
  );
}
