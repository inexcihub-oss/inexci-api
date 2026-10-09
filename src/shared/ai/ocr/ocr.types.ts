export type OcrSource = 'image' | 'pdf-native' | 'pdf-rasterized' | 'pdf-mixed';

export interface OcrInput {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  maxPages?: number;
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  source: 'text-layer' | 'ocr';
}

export interface OcrResult {
  text: string;
  confidence: number;
  pageCount: number;
  pagesProcessed: number;
  truncatedPages: number;
  source: OcrSource;
  pages: OcrPageResult[];
  durationMs: number;
  warnings: string[];
}

export class OcrUnsupportedMimeError extends Error {
  constructor(public readonly mimeType: string) {
    super(`OCR não suporta mimeType=${mimeType}`);
    this.name = 'OcrUnsupportedMimeError';
  }
}
