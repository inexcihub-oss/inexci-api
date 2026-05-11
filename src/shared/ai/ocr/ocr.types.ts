export type OcrSource = 'image' | 'pdf-native' | 'pdf-rasterized' | 'pdf-mixed';

export interface OcrInput {
  /** Conteúdo binário do documento. */
  buffer: Buffer;
  /** mimeType reportado pelo Twilio / WhatsappMediaService. */
  mimeType: string;
  /** Nome opcional para logs (sem PII). */
  filename?: string;
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  /** Confiança 0..1. Para `text-layer` retornamos 0.99. */
  confidence: number;
  source: 'text-layer' | 'ocr';
}

export interface OcrResult {
  /** Texto consolidado (todas as páginas, separadas por \n\n). */
  text: string;
  /** Confiança média 0..1 (média simples por página). */
  confidence: number;
  /** Total de páginas do PDF original (1 para imagens). */
  pageCount: number;
  /** Páginas que conseguimos extrair texto (limitado por AI_DOC_MAX_PAGES). */
  pagesProcessed: number;
  /** Páginas adicionais cortadas pelo limit. */
  truncatedPages: number;
  source: OcrSource;
  pages: OcrPageResult[];
  durationMs: number;
  /** Avisos não-fatais (ex.: preprocess_failed, page_2_failed). */
  warnings: string[];
}

export class OcrUnsupportedMimeError extends Error {
  constructor(public readonly mimeType: string) {
    super(`OCR não suporta mimeType=${mimeType}`);
    this.name = 'OcrUnsupportedMimeError';
  }
}
