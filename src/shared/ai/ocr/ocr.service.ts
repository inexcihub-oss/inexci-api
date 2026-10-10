import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import { PiiVaultService } from '../services/pii-vault.service';
import {
  OcrInput,
  OcrPageResult,
  OcrResult,
  OcrUnsupportedMimeError,
} from './ocr.types';
import { inexciTracer, SpanStatusCode } from '../../observability/tracer';

const MIN_NATIVE_PDF_TEXT_CHARS = 100;

interface PdfParseTextResult {
  text: string;
  total?: number;
  numpages?: number;
}

interface PdfParseScreenshotPage {
  pageNumber?: number;
  data?: Buffer;
}

interface PdfParseScreenshotResult {
  pages?: PdfParseScreenshotPage[];
}

interface PdfParsePageInfo {
  pageNumber?: number;
  width?: number;
  height?: number;
}

interface PdfParseInfoResult {
  pages?: PdfParsePageInfo[];
}

interface PdfParseInstance {
  getText(): Promise<PdfParseTextResult>;
  getInfo(opts: {
    parsePageInfo?: boolean;
    first?: number;
    last?: number;
  }): Promise<PdfParseInfoResult>;
  getScreenshot(opts: {
    scale?: number;
    first?: number;
    imageBuffer?: boolean;
    imageDataUrl?: boolean;
  }): Promise<PdfParseScreenshotResult>;
  destroy?(): Promise<void>;
}

type PdfParseCtor = new (opts: { data: Buffer }) => PdfParseInstance;

const PDF_RASTER_SCALE = 2;

export const MAX_PIXELS_POR_PAGINA = 25_000_000;

export function calcularEscalaSegura(
  larguraPt: number,
  alturaPt: number,
  escalaDesejada = PDF_RASTER_SCALE,
): number {
  const pixels = larguraPt * escalaDesejada * (alturaPt * escalaDesejada);
  if (pixels <= MAX_PIXELS_POR_PAGINA) return escalaDesejada;
  return Math.max(
    0.25,
    Math.sqrt(MAX_PIXELS_POR_PAGINA / (larguraPt * alturaPt)),
  );
}

const sharpConcurrency = (
  sharp as unknown as { concurrency?: (n: number) => number }
).concurrency;
if (typeof sharpConcurrency === 'function') {
  sharpConcurrency(1);
}

@Injectable()
export class OcrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private workerPromise: Promise<TesseractWorker> | null = null;
  private workerPool: Array<Promise<TesseractWorker>> = [];
  private readonly lang: string;
  private readonly maxPages: number;
  private readonly parallelWorkers: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly piiVault: PiiVaultService,
  ) {
    const rawLang = this.configService.get<string>('AI_DOC_OCR_LANG', 'por');
    this.lang = (rawLang && rawLang.trim()) || 'por';

    const rawMaxPages = this.configService.get<number>('AI_DOC_MAX_PAGES', 15);
    const numericMaxPages = Number(rawMaxPages);
    this.maxPages =
      Number.isFinite(numericMaxPages) && numericMaxPages > 0
        ? Math.floor(numericMaxPages)
        : 15;

    const rawParallelWorkers = this.configService.get<number>(
      'AI_DOC_OCR_PARALLEL_WORKERS',
      3,
    );
    const numericParallelWorkers = Number(rawParallelWorkers);
    this.parallelWorkers =
      Number.isFinite(numericParallelWorkers) && numericParallelWorkers > 0
        ? Math.max(1, Math.min(8, Math.floor(numericParallelWorkers)))
        : 3;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureWorkerPool();
      this.logger.log(
        `[AI_DOC_OCR] pool Tesseract pré-carregado workers=${this.parallelWorkers}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_OCR] warmup do pool falhou: ${err?.message || 'erro desconhecido'}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = [...this.workerPool];
    this.workerPool = [];
    this.workerPromise = null;

    await Promise.allSettled(
      pool.map(async (workerPromise) => {
        try {
          const worker = await workerPromise;
          await worker.terminate();
        } catch (err: any) {
          this.logger.debug(
            `[AI_DOC_OCR] terminate falhou: ${err?.message || 'erro desconhecido'}`,
          );
        }
      }),
    );
  }

  isImage(mimeType: string): boolean {
    return /^image\//i.test(mimeType ?? '');
  }

  isPdf(mimeType: string): boolean {
    return (mimeType ?? '').toLowerCase() === 'application/pdf';
  }

  private resolveMaxPages(override?: number): number {
    if (
      typeof override === 'number' &&
      Number.isFinite(override) &&
      override > 0
    ) {
      return Math.floor(override);
    }
    return this.maxPages;
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    const startedAt = Date.now();
    if (this.isImage(input.mimeType)) {
      return this.extractFromImage(input, startedAt);
    }
    if (this.isPdf(input.mimeType)) {
      return this.extractFromPdf(input, startedAt);
    }
    throw new OcrUnsupportedMimeError(input.mimeType);
  }

  async extractAndTokenize(
    input: OcrInput,
    sessionId: string,
  ): Promise<OcrResult & { tokenizedText: string }> {
    return inexciTracer.startActiveSpan(
      'ocr.extractAndTokenize',
      async (span) => {
        span.setAttribute('ocr.mime', input.mimeType);
        span.setAttribute('ocr.size_bytes', input.buffer.length);
        const t0 = Date.now();
        try {
          const result = await this.extract(input);
          span.setAttribute('ocr.source', result.source);
          span.setAttribute('ocr.pages', result.pages.length);
          span.setAttribute('ocr.duration_ms', Date.now() - t0);
          span.setAttribute('ocr.text_length', result.text.length);
          const tokenizedText = this.piiVault.preprocessUserInput(
            sessionId,
            result.text,
          );
          span.setStatus({ code: SpanStatusCode.OK });
          return { ...result, tokenizedText };
        } catch (e: any) {
          span.recordException(e);
          span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
          throw e;
        } finally {
          span.end();
        }
      },
    );
  }

  async rasterizeFirstPdfPage(buffer: Buffer): Promise<Buffer | null> {
    const PDFParseCtor = await this.loadPdfParseCtor();
    if (!PDFParseCtor) return null;

    let parser: PdfParseInstance | undefined;
    try {
      parser = new PDFParseCtor({ data: buffer });
      const scale = await this.resolveSafeRasterScale(parser, 1);
      const screenshot = await parser.getScreenshot({
        scale,
        first: 1,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const screenshotPages = Array.isArray(screenshot?.pages)
        ? screenshot.pages
        : [];
      const firstPage = screenshotPages[0];
      const data: Buffer | undefined = firstPage?.data;
      if (!data) return null;

      try {
        const sharpFactory =
          (sharp as unknown as { default?: typeof sharp }).default ||
          (sharp as unknown as typeof sharp);
        return await (sharpFactory as any)(data, {
          limitInputPixels: MAX_PIXELS_POR_PAGINA,
        })
          .rotate()
          .png()
          .toBuffer();
      } catch {
        return data;
      }
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_OCR] rasterizeFirstPdfPage falhou: ${err?.message || 'erro desconhecido'}`,
      );
      return null;
    } finally {
      try {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      } catch (err) {
        this.logger.debug(
          `[AI_DOC_OCR] falha ao liberar pdf-parse: ${(err as Error)?.message}`,
        );
      }
    }
  }

  private async resolveSafeRasterScale(
    parser: PdfParseInstance,
    maxPages: number,
  ): Promise<number> {
    try {
      const info = await parser.getInfo({
        parsePageInfo: true,
        first: maxPages,
      });
      const infoPages = Array.isArray(info?.pages) ? info.pages : [];
      if (!infoPages.length) return PDF_RASTER_SCALE;

      let menorEscala = PDF_RASTER_SCALE;
      for (const page of infoPages) {
        const largura = Number(page?.width) || 0;
        const altura = Number(page?.height) || 0;
        if (largura <= 0 || altura <= 0) continue;
        const escala = calcularEscalaSegura(largura, altura);
        if (escala < menorEscala) menorEscala = escala;
      }
      return menorEscala;
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_OCR] falha ao ler dimensões da página antes de rasterizar: ${err?.message || 'erro desconhecido'}`,
      );
      return PDF_RASTER_SCALE;
    }
  }

  private async extractFromImage(
    input: OcrInput,
    startedAt: number,
  ): Promise<OcrResult> {
    const warnings: string[] = [];
    const preprocessed = await this.preprocessImage(input.buffer, warnings);
    const { text, confidence } = await this.runTesseract(preprocessed);

    const pageResult: OcrPageResult = {
      pageNumber: 1,
      text,
      confidence,
      source: 'ocr',
    };

    const consolidated = text.trim();
    return {
      text: consolidated,
      confidence,
      pageCount: 1,
      pagesProcessed: 1,
      truncatedPages: 0,
      source: 'image',
      pages: [pageResult],
      durationMs: Date.now() - startedAt,
      warnings,
    };
  }

  private async preprocessImage(
    buffer: Buffer,
    warnings: string[],
  ): Promise<Buffer> {
    try {
      const sharpFactory =
        (sharp as unknown as { default?: typeof sharp }).default ||
        (sharp as unknown as typeof sharp);

      return await (sharpFactory as any)(buffer, {
        limitInputPixels: MAX_PIXELS_POR_PAGINA,
      })
        .rotate()
        .grayscale()
        .normalize()
        .resize({ width: 2000, withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch (err: any) {
      warnings.push(`preprocess_failed:${err?.message || 'erro desconhecido'}`);
      return buffer;
    }
  }

  private async extractFromPdf(
    input: OcrInput,
    startedAt: number,
  ): Promise<OcrResult> {
    const warnings: string[] = [];

    const PDFParseCtor = await this.loadPdfParseCtor();
    if (!PDFParseCtor) {
      warnings.push('pdf_parse_unavailable');
      return this.buildEmptyPdfResult(0, startedAt, warnings, 'pdf-rasterized');
    }

    let pageCount = 0;
    let nativeText = '';

    let parser: PdfParseInstance | undefined;
    try {
      parser = new PDFParseCtor({ data: input.buffer });
      const textResult = await parser.getText();
      nativeText = (textResult?.text || '').toString();
      pageCount = Number(textResult?.total ?? textResult?.numpages ?? 0) || 0;
    } catch (err: any) {
      warnings.push(`pdf_parse_text_failed:${err?.message || 'erro'}`);
    } finally {
      try {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      } catch (err) {
        this.logger.debug(
          `[AI_DOC_OCR] falha ao liberar pdf-parse: ${(err as Error)?.message}`,
        );
      }
    }

    const trimmedNative = nativeText.trim();
    if (trimmedNative.length >= MIN_NATIVE_PDF_TEXT_CHARS) {
      return {
        text: trimmedNative,
        confidence: 0.99,
        pageCount,
        pagesProcessed: 1,
        truncatedPages: 0,
        source: 'pdf-native',
        pages: [
          {
            pageNumber: 1,
            text: trimmedNative,
            confidence: 0.99,
            source: 'text-layer',
          },
        ],
        durationMs: Date.now() - startedAt,
        warnings,
      };
    }

    const maxPages = this.resolveMaxPages(input.maxPages);
    const ocrPages = await this.rasterizeAndOcrPdf(
      PDFParseCtor,
      input.buffer,
      warnings,
      maxPages,
    );

    if (!pageCount && ocrPages.length) {
      pageCount = ocrPages.length;
    }
    const truncatedPages = Math.max(
      0,
      pageCount > maxPages ? pageCount - maxPages : 0,
    );

    const text = ocrPages
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p) => {
        const trimmed = p.text.trim();
        return trimmed ? `[PÁGINA ${p.pageNumber}]\n${trimmed}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    const confidence =
      ocrPages.length > 0
        ? ocrPages.reduce((acc, p) => acc + (p.confidence || 0), 0) /
          ocrPages.length
        : 0;

    return {
      text,
      confidence,
      pageCount: pageCount || ocrPages.length,
      pagesProcessed: ocrPages.length,
      truncatedPages,
      source: 'pdf-rasterized',
      pages: ocrPages,
      durationMs: Date.now() - startedAt,
      warnings,
    };
  }

  private async rasterizeAndOcrPdf(
    PDFParseCtor: PdfParseCtor,
    buffer: Buffer,
    warnings: string[],
    maxPages: number,
  ): Promise<OcrPageResult[]> {
    const pages: OcrPageResult[] = [];
    let parser: PdfParseInstance | undefined;
    try {
      parser = new PDFParseCtor({ data: buffer });
      const scale = await this.resolveSafeRasterScale(parser, maxPages);
      const screenshot = await parser.getScreenshot({
        scale,
        first: maxPages,
        imageBuffer: true,
        imageDataUrl: false,
      });

      const screenshotPages = Array.isArray(screenshot?.pages)
        ? screenshot.pages
        : [];

      const pageJobs = screenshotPages
        .map((page, index) => ({
          pageNumber: Number(page?.pageNumber ?? index + 1),
          data: page?.data,
        }))
        .filter((job) => {
          if (!job.data) {
            warnings.push(`page_${job.pageNumber}_no_buffer`);
            return false;
          }
          return true;
        });

      if (!pageJobs.length) {
        return pages;
      }

      const preprocessed = await Promise.all(
        pageJobs.map(async (job) => {
          const data = job.data as Buffer;
          const buffer = await this.preprocessImage(data, warnings);
          return { pageNumber: job.pageNumber, buffer };
        }),
      );

      const ocrResults = await this.runTesseractParallel(
        preprocessed.map((job) => job.buffer),
      );

      for (let i = 0; i < preprocessed.length; i++) {
        const job = preprocessed[i];
        const ocr = ocrResults[i];
        if (!ocr) {
          warnings.push(`page_${job.pageNumber}_ocr_failed:resultado_vazio`);
          continue;
        }
        pages.push({
          pageNumber: job.pageNumber,
          text: ocr.text,
          confidence: ocr.confidence,
          source: 'ocr',
        });
      }

      pages.sort((a, b) => a.pageNumber - b.pageNumber);
    } catch (err: any) {
      warnings.push(`pdf_screenshot_failed:${err?.message || 'erro'}`);
    } finally {
      try {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      } catch (err) {
        this.logger.debug(
          `[AI_DOC_OCR] falha ao liberar pdf-parse: ${(err as Error)?.message}`,
        );
      }
    }
    return pages;
  }

  private buildEmptyPdfResult(
    pageCount: number,
    startedAt: number,
    warnings: string[],
    source: 'pdf-native' | 'pdf-rasterized' | 'pdf-mixed',
  ): OcrResult {
    return {
      text: '',
      confidence: 0,
      pageCount,
      pagesProcessed: 0,
      truncatedPages: 0,
      source,
      pages: [],
      durationMs: Date.now() - startedAt,
      warnings,
    };
  }

  private async loadPdfParseCtor(): Promise<PdfParseCtor | null> {
    try {
      const mod = await import('pdf-parse');
      const ctor =
        (mod as unknown as { PDFParse?: PdfParseCtor })?.PDFParse ??
        (mod as unknown as { default?: { PDFParse?: PdfParseCtor } })?.default
          ?.PDFParse ??
        null;
      return ctor;
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_OCR] pdf-parse indisponível: ${err?.message || 'erro'}`,
      );
      return null;
    }
  }

  private async runTesseract(
    buffer: Buffer,
  ): Promise<{ text: string; confidence: number }> {
    const workers = await this.ensureWorkerPool();
    return this.runTesseractWithWorker(workers[0], buffer);
  }

  private async runTesseractParallel(
    buffers: Buffer[],
  ): Promise<Array<{ text: string; confidence: number } | null>> {
    if (!buffers.length) return [];

    const workers = await this.ensureWorkerPool();
    const results: Array<{ text: string; confidence: number } | null> =
      new Array(buffers.length).fill(null);
    let nextIndex = 0;

    const workerLoop = async (worker: TesseractWorker): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= buffers.length) return;

        try {
          results[index] = await this.runTesseractWithWorker(
            worker,
            buffers[index],
          );
        } catch (err: any) {
          results[index] = null;
          this.logger.warn(
            `[AI_DOC_OCR] page_ocr_failed index=${index} reason=${err?.message || 'erro'}`,
          );
        }
      }
    };

    await Promise.all(workers.map((worker) => workerLoop(worker)));
    return results;
  }

  private async runTesseractWithWorker(
    worker: TesseractWorker,
    buffer: Buffer,
  ): Promise<{ text: string; confidence: number }> {
    const result: any = await worker.recognize(buffer);
    const text = (result?.data?.text || '').toString();
    const confidencePercent = Number(result?.data?.confidence ?? 0);
    const confidence = Math.max(
      0,
      Math.min(
        1,
        (Number.isFinite(confidencePercent) ? confidencePercent : 0) / 100,
      ),
    );
    return { text, confidence };
  }

  private async ensureWorkerPool(): Promise<TesseractWorker[]> {
    while (this.workerPool.length < this.parallelWorkers) {
      const workerPromise = createWorker(this.lang).catch((err) => {
        throw err;
      });
      this.workerPool.push(workerPromise);
    }
    return Promise.all(this.workerPool);
  }

  private async getWorker(): Promise<TesseractWorker> {
    if (!this.workerPromise) {
      this.workerPromise = this.ensureWorkerPool().then(
        (workers) => workers[0],
      );
    }
    return this.workerPromise;
  }
}
