export const UPLOAD_MAX_CAMPOS = 20;
export const UPLOAD_MAX_TAMANHO_CAMPO = 64 * 1024;

export interface LimitesUpload {
  fileSize: number;
  files: number;
  fields: number;
  fieldSize: number;
  parts: number;
}

export function limitesDeUpload(
  fileSize: number,
  files = 1,
): { limits: LimitesUpload } {
  return {
    limits: {
      fileSize,
      files,
      fields: UPLOAD_MAX_CAMPOS,
      fieldSize: UPLOAD_MAX_TAMANHO_CAMPO,
      parts: files + UPLOAD_MAX_CAMPOS,
    },
  };
}
