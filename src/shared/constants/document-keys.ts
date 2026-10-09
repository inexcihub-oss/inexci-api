export const DOCUMENT_KEYS = {
  REPORT_IMAGES: 'report_images',
  DOCTOR_REQUEST: 'doctorRequest',
  SC_CREATION_SOURCE: 'sc_creation_source',
} as const;

export const PDF_EXCLUDED_DOCUMENT_KEYS: readonly string[] = [
  DOCUMENT_KEYS.REPORT_IMAGES,
  DOCUMENT_KEYS.SC_CREATION_SOURCE,
];

export type DocumentKey = (typeof DOCUMENT_KEYS)[keyof typeof DOCUMENT_KEYS];
