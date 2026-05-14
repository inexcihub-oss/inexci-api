import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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

/**
 * Limite mínimo de caracteres "úteis" extraídos via text-layer do PDF para
 * que consideremos o PDF como nativo. Abaixo disso, caímos no caminho de
 * rasterização + OCR (PDFs escaneados ou laudos com texto incorporado em
 * imagens).
 */
const MIN_NATIVE_PDF_TEXT_CHARS = 100;

/**
 * Subconjunto da API pública do `pdf-parse@2` utilizado neste serviço.
 * Tipagem explícita evita `any` na instanciação e nas chamadas de método,
 * satisfazendo o strict mode sem depender de `@types/pdf-parse`.
 */
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

interface PdfParseInstance {
  getText(): Promise<PdfParseTextResult>;
  getScreenshot(opts: {
    scale?: number;
    first?: number;
    imageBuffer?: boolean;
    imageDataUrl?: boolean;
  }): Promise<PdfParseScreenshotResult>;
  destroy?(): Promise<void>;
}

type PdfParseCtor = new (opts: { data: Buffer }) => PdfParseInstance;

/**
 * Escala de rasterização. Maior = melhor OCR, mais memória/CPU.
 * 2x cobre a maioria dos casos clínicos com letra pequena.
 */
const PDF_RASTER_SCALE = 2;

@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private workerPromise: Promise<TesseractWorker> | null = null;
  private readonly lang: string;
  private readonly maxPages: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly piiVault: PiiVaultService,
  ) {
    const rawLang = this.configService.get<string>('AI_DOC_OCR_LANG', 'por');
    this.lang = (rawLang && rawLang.trim()) || 'por';

    const rawMaxPages = this.configService.get<number>('AI_DOC_MAX_PAGES', 5);
    const numericMaxPages = Number(rawMaxPages);
    this.maxPages =
      Number.isFinite(numericMaxPages) && numericMaxPages > 0
        ? Math.floor(numericMaxPages)
        : 5;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.workerPromise) return;
    try {
      const worker = await this.workerPromise;
      await worker.terminate();
    } catch (err: any) {
      this.logger.debug(
        `[AI_DOC_OCR] terminate falhou: ${err?.message || 'erro desconhecido'}`,
      );
    } finally {
      this.workerPromise = null;
    }
  }

  isImage(mimeType: string): boolean {
    return /^image\//i.test(mimeType ?? '');
  }

  isPdf(mimeType: string): boolean {
    return (mimeType ?? '').toLowerCase() === 'application/pdf';
  }

  /**
   * Roda OCR no documento e devolve apenas o resultado bruto (sem tokenização).
   * O chamador é responsável por tokenizar antes de logar/persistir/enviar
   * para LLM externo. Use `extractAndTokenize` para o caminho seguro.
   */
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

  /**
   * Caminho preferido: extrai e já tokeniza CPF/telefone/email via
   * `PiiVaultService.preprocessUserInput`. Garante que nada de PII estruturada
   * vaza para o LLM externo (LGPD). Texto do laudo flui inteiro — sem
   * `payload_blob` — para o classificador conseguir extrair os campos.
   */
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

  /**
   * Rasteriza a primeira página de um PDF como PNG. Usado pelo Vision
   * fallback quando o classifier text-only é insuficiente em PDFs (gpt-4o
   * Vision aceita só imagens). Retorna `null` se a lib não estiver
   * disponível ou se o PDF estiver corrompido.
   */
  async rasterizeFirstPdfPage(buffer: Buffer): Promise<Buffer | null> {
    const PDFParseCtor = await this.loadPdfParseCtor();
    if (!PDFParseCtor) return null;

    let parser: PdfParseInstance | undefined;
    try {
      parser = new PDFParseCtor({ data: buffer });
      const screenshot = await parser.getScreenshot({
        scale: PDF_RASTER_SCALE,
        first: 1,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const screenshotPages = Array.isArray(screenshot?.pages)
        ? screenshot.pages
        : [];
      const firstPage = screenshotPages[0];
      const data: Buffer | undefined = firstPage?.data;
      return data ?? null;
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
      } catch {
        /* ignore */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Imagem
  // -------------------------------------------------------------------------

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
      // sharp: módulo CJS sem named export consistente entre versões.
      const sharpFactory =
        (sharp as unknown as { default?: typeof sharp }).default ||
        (sharp as unknown as typeof sharp);

      return await (sharpFactory as any)(buffer)
        .rotate() // auto-orient via EXIF
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

  // -------------------------------------------------------------------------
  // PDF
  // -------------------------------------------------------------------------

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

    // Tentativa 1: extração via text-layer (PDFs nativos).
    let parser: PdfParseInstance | undefined;
    try {
      parser = new PDFParseCtor({ data: input.buffer });
      const textResult = await parser.getText();
      nativeText = (textResult?.text || '').toString();
      pageCount = Number(textResult?.total ?? textResult?.numpages ?? 0) || 0;
    } catch (err: any) {
      warnings.push(`pdf_parse_text_failed:${err?.message || 'erro'}`);
    } finally {
      // O destroy abaixo é seguro: se falhou em criar parser, simplesmente
      // não destruímos. Se criou, liberamos antes de tentar getScreenshot.
      try {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      } catch {
        /* ignore */
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

    // Tentativa 2: rasterizar e rodar Tesseract.
    const ocrPages = await this.rasterizeAndOcrPdf(
      PDFParseCtor,
      input.buffer,
      warnings,
    );

    if (!pageCount && ocrPages.length) {
      pageCount = ocrPages.length;
    }
    const truncatedPages = Math.max(
      0,
      pageCount > this.maxPages ? pageCount - this.maxPages : 0,
    );

    const text = ocrPages
      .map((p) => p.text.trim())
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
  ): Promise<OcrPageResult[]> {
    const pages: OcrPageResult[] = [];
    let parser: PdfParseInstance | undefined;
    try {
      parser = new PDFParseCtor({ data: buffer });
      const screenshot = await parser.getScreenshot({
        scale: PDF_RASTER_SCALE,
        first: this.maxPages,
        imageBuffer: true,
        imageDataUrl: false,
      });

      const screenshotPages = Array.isArray(screenshot?.pages)
        ? screenshot.pages
        : [];

      for (let i = 0; i < screenshotPages.length; i++) {
        const page = screenshotPages[i];
        const pageNumber = Number(page?.pageNumber ?? i + 1);
        const data: Buffer | undefined = page?.data;
        if (!data) {
          warnings.push(`page_${pageNumber}_no_buffer`);
          continue;
        }
        try {
          const { text, confidence } = await this.runTesseract(data);
          pages.push({
            pageNumber,
            text,
            confidence,
            source: 'ocr',
          });
        } catch (err: any) {
          warnings.push(
            `page_${pageNumber}_ocr_failed:${err?.message || 'erro'}`,
          );
        }
      }
    } catch (err: any) {
      warnings.push(`pdf_screenshot_failed:${err?.message || 'erro'}`);
    } finally {
      try {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      } catch {
        /* ignore */
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

  /**
   * Carrega `PDFParse` lazy. Mantemos `await import` para que a falha de
   * carregamento (ex.: lib nativa ausente em ambientes de teste) seja
   * tratada como warning e não derrube o boot da app.
   */
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

  // -------------------------------------------------------------------------
  // Tesseract
  // -------------------------------------------------------------------------

  private async runTesseract(
    buffer: Buffer,
  ): Promise<{ text: string; confidence: number }> {
    const worker = await this.getWorker();
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

  /**
   * Worker Tesseract singleton (lazy). Reaproveita o `traineddata` carregado
   * (~10MB) entre chamadas, reduzindo drasticamente o cold-start a partir da
   * segunda imagem/página.
   */
  private async getWorker(): Promise<TesseractWorker> {
    if (!this.workerPromise) {
      this.workerPromise = createWorker(this.lang).catch((err) => {
        this.workerPromise = null;
        throw err;
      });
    }
    return this.workerPromise;
  }
}
