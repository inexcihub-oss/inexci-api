import { Injectable, Logger, Optional } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { DocumentClassifierService } from './document-classifier.service';
import { DocumentVisionFallbackService } from './document-vision-fallback.service';
import {
  DocumentClassification,
  DocumentClassificationExtracted,
  DocumentClassificationIntent,
} from './document-classifier.types';
import { PiiVaultService } from '../services/pii-vault.service';

export interface ExtractFromBufferInput {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  /** Identificador de correlação para logs (conversationId, sessionId, etc.). */
  sessionId: string;
  intent?: DocumentClassificationIntent;
  /**
   * Limite de páginas no OCR de PDFs escaneados. Omitido = `AI_DOC_MAX_PAGES`.
   */
  maxOcrPages?: number;
  /**
   * Quando `true`, aplica de-tokenização PII nos campos de `extracted` antes
   * de retornar — necessário no fluxo HTTP para que o frontend receba valores
   * reais em vez de placeholders `{{cpf_1}}`.
   */
  detokenizeExtracted?: boolean;
}

export interface ClassifierUsageSnapshot {
  stage: 'doc_classifier' | 'doc_vision_fallback';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
}

export type ExtractFromBufferStatus =
  | 'ok'
  | 'ocr_empty'
  | 'ocr_exception'
  | 'classifier_failed';

export interface ExtractFromBufferTiming {
  totalMs: number;
  ocrMs: number;
  classifierMs: number;
  visionRasterizeMs: number;
  visionMs: number;
  detokenizeMs: number;
}

export interface ExtractFromBufferOutput {
  status: ExtractFromBufferStatus;
  classification: DocumentClassification | null;
  usedVisionFallback: boolean;
  usageSnapshots: ClassifierUsageSnapshot[];
  /** Texto OCR já tokenizado pelo PII Vault (quando disponível). */
  ocrTokenizedText: string;
  /** Origem do texto: pdf-native, pdf-rasterized, image, etc. */
  ocrSource?: string;
  timing: ExtractFromBufferTiming;
  errorReason?: string;
}

const VISION_TRIGGER_OCR_MIN_CHARS = 30;
const VISION_TRIGGER_MIN_CONFIDENCE = 0.75;

/**
 * Pipeline puro de extração de documento a partir de um buffer.
 * Orquestra: OCR → tokenização PII → classificação (AI_DOC_CLASSIFIER_MODEL) → Vision
 * fallback (gpt-4o quando necessário). Não acessa storage, filas nem banco —
 * é chamado tanto pelo fluxo WhatsApp quanto pelo endpoint HTTP.
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  constructor(
    private readonly ocr: OcrService,
    private readonly classifier: DocumentClassifierService,
    @Optional()
    private readonly visionFallback?: DocumentVisionFallbackService,
    @Optional()
    private readonly piiVault?: PiiVaultService,
  ) {}

  async extractFromBuffer(
    input: ExtractFromBufferInput,
  ): Promise<ExtractFromBufferOutput> {
    const { buffer, mimeType, filename, sessionId, intent } = input;
    const usageSnapshots: ClassifierUsageSnapshot[] = [];
    const pipelineStartedAt = Date.now();
    const timing: ExtractFromBufferTiming = {
      totalMs: 0,
      ocrMs: 0,
      classifierMs: 0,
      visionRasterizeMs: 0,
      visionMs: 0,
      detokenizeMs: 0,
    };

    let ocrResult: Awaited<ReturnType<OcrService['extractAndTokenize']>> | null;
    let ocrFailureReason: string | null = null;
    const ocrStartedAt = Date.now();
    try {
      ocrResult = await this.ocr.extractAndTokenize(
        { buffer, mimeType, filename, maxPages: input.maxOcrPages },
        sessionId,
      );
      timing.ocrMs = ocrResult.durationMs ?? Date.now() - ocrStartedAt;
    } catch (err: any) {
      ocrResult = null;
      timing.ocrMs = Date.now() - ocrStartedAt;
      ocrFailureReason = err?.message || 'erro desconhecido no OCR';
      this.logger.warn(
        `[DOC_EXTRACT] sid=${sessionId} status=ocr_exception reason=${ocrFailureReason} ocr_ms=${timing.ocrMs}`,
      );
    }

    if (ocrResult) {
      this.logger.log(
        `[DOC_EXTRACT] sid=${sessionId} source=${ocrResult.source} pages=${ocrResult.pagesProcessed}/${ocrResult.pageCount} confidence=${ocrResult.confidence.toFixed(2)} duration_ms=${ocrResult.durationMs} chars=${(ocrResult.text ?? '').length}`,
      );
    }

    const ocrText = ocrResult?.text?.trim() ?? '';
    const ocrTextTooShort = ocrText.length < VISION_TRIGGER_OCR_MIN_CHARS;
    const ocrConfidenceLow =
      !!ocrResult && ocrResult.confidence < VISION_TRIGGER_MIN_CONFIDENCE;
    const ocrUnusable = !ocrResult || ocrTextTooShort || ocrConfidenceLow;

    let classification: DocumentClassification | null = null;
    let classifierError: string | null = null;
    let usedVisionFallback = false;

    if (ocrResult && !ocrTextTooShort) {
      const classifierStartedAt = Date.now();
      try {
        const result = await this.classifier.classifyWithUsage({
          text: ocrResult.tokenizedText,
          intent,
          messageSid: sessionId,
        });
        classification = result.classification;
        timing.classifierMs =
          result.usage.latencyMs ?? Date.now() - classifierStartedAt;
        usageSnapshots.push({ stage: 'doc_classifier', ...result.usage });
        this.logger.log(
          `[DOC_EXTRACT] sid=${sessionId} stage=text_classifier kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} classifier_ms=${timing.classifierMs}`,
        );
      } catch (err: any) {
        timing.classifierMs = Date.now() - classifierStartedAt;
        classifierError = err?.message || 'classifier indisponível';
        this.logger.warn(
          `[DOC_EXTRACT] sid=${sessionId} status=classifier_failed reason=${classifierError} classifier_ms=${timing.classifierMs}`,
        );
      }
    }

    const classifierConfidenceLow =
      !!classification &&
      classification.confidence < VISION_TRIGGER_MIN_CONFIDENCE;
    const classifierKindUnknown =
      !!classification && classification.kind === 'unknown';
    const classifierExtractedEmpty =
      !!classification && this.isExtractedEffectivelyEmpty(classification);

    const isPdf = (mimeType || '').toLowerCase() === 'application/pdf';
    const isImage = this.visionFallback?.isSupportedImageMime(mimeType);
    const visionEnabled = !!this.visionFallback?.isEnabled();

    const hasUsableTextExtraction =
      !!classification && !this.isExtractedEffectivelyEmpty(classification);
    const skipVisionForScReview =
      input.intent === 'create_sc' && hasUsableTextExtraction;

    const shouldTryVisionFallback =
      visionEnabled &&
      (isImage || isPdf) &&
      !skipVisionForScReview &&
      (ocrUnusable ||
        classifierError ||
        classifierConfidenceLow ||
        classifierKindUnknown ||
        classifierExtractedEmpty);

    this.logger.log(
      `[DOC_EXTRACT] sid=${sessionId} vision_enabled=${visionEnabled} mime_supported=${!!isImage || isPdf} ocr_unusable=${ocrUnusable} classifier_confidence_low=${classifierConfidenceLow} skip_vision_sc_review=${skipVisionForScReview} => will_try_vision=${shouldTryVisionFallback}`,
    );

    if (shouldTryVisionFallback && this.visionFallback) {
      let visionImageBuffer: Buffer | null = buffer;
      let visionMimeType = mimeType;
      if (isPdf) {
        const rasterizeStartedAt = Date.now();
        visionImageBuffer = await this.ocr.rasterizeFirstPdfPage(buffer);
        timing.visionRasterizeMs = Date.now() - rasterizeStartedAt;
        visionMimeType = 'image/png';
        if (!visionImageBuffer) {
          this.logger.warn(
            `[DOC_EXTRACT] sid=${sessionId} status=vision_failed reason=pdf_rasterize_failed vision_rasterize_ms=${timing.visionRasterizeMs}`,
          );
        }
      }

      if (visionImageBuffer) {
        const visionStartedAt = Date.now();
        try {
          const visionResult = await this.visionFallback.classifyImage({
            imageBuffer: visionImageBuffer,
            imageMimeType: visionMimeType,
            intent,
            conversationId: sessionId,
            messageSid: sessionId,
          });
          classification = visionResult.classification;
          usedVisionFallback = true;
          timing.visionMs =
            visionResult.usage.latencyMs ?? Date.now() - visionStartedAt;
          usageSnapshots.push({
            stage: 'doc_vision_fallback',
            ...visionResult.usage,
          });
          classifierError = null;
          this.logger.log(
            `[DOC_EXTRACT] sid=${sessionId} stage=vision_llm kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} vision_ms=${timing.visionMs}`,
          );
        } catch (err: any) {
          timing.visionMs = Date.now() - visionStartedAt;
          this.logger.warn(
            `[DOC_EXTRACT] sid=${sessionId} status=vision_failed reason=${err?.message || 'erro'} vision_ms=${timing.visionMs}`,
          );
        }
      }
    }

    const logTimingSummary = (
      status: ExtractFromBufferStatus,
      extra?: string,
    ) => {
      timing.totalMs = Date.now() - pipelineStartedAt;
      const pipeline = usedVisionFallback
        ? 'ocr→text_classifier→vision_llm'
        : classification
          ? 'ocr→text_classifier'
          : ocrUnusable
            ? 'ocr→vision_llm_skipped_or_failed'
            : 'ocr→text_classifier_failed';
      this.logger.log(
        [
          `[DOC_EXTRACT] sid=${sessionId} timing_summary`,
          `status=${status}`,
          `pipeline=${pipeline}`,
          `total_ms=${timing.totalMs}`,
          `ocr_ms=${timing.ocrMs}`,
          `classifier_ms=${timing.classifierMs}`,
          `vision_rasterize_ms=${timing.visionRasterizeMs}`,
          `vision_ms=${timing.visionMs}`,
          `detokenize_ms=${timing.detokenizeMs}`,
          `used_vision=${usedVisionFallback}`,
          `ocr_source=${ocrResult?.source ?? 'none'}`,
          extra ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    };

    if (!classification) {
      if (ocrUnusable && !classifierError) {
        logTimingSummary(ocrFailureReason ? 'ocr_exception' : 'ocr_empty');
        return {
          status: ocrFailureReason ? 'ocr_exception' : 'ocr_empty',
          classification: null,
          usedVisionFallback: false,
          usageSnapshots,
          ocrTokenizedText: '',
          ocrSource: ocrResult?.source,
          timing,
          errorReason: ocrFailureReason ?? 'texto insuficiente no documento',
        };
      }
      logTimingSummary('classifier_failed');
      return {
        status: 'classifier_failed',
        classification: null,
        usedVisionFallback: false,
        usageSnapshots,
        ocrTokenizedText: ocrResult?.tokenizedText ?? '',
        ocrSource: ocrResult?.source,
        timing,
        errorReason: classifierError ?? 'classificador indisponível',
      };
    }

    classification = {
      ...classification,
      extracted: this.enrichExtractedFromOcrPii(
        sessionId,
        classification.extracted,
        ocrResult?.tokenizedText ?? '',
      ),
    };

    if (input.detokenizeExtracted && this.piiVault) {
      const detokenizeStartedAt = Date.now();
      classification = {
        ...classification,
        extracted: this.detokenizeExtractedFields(
          sessionId,
          classification.extracted,
        ),
      };
      timing.detokenizeMs = Date.now() - detokenizeStartedAt;
    }

    logTimingSummary('ok');

    return {
      status: 'ok',
      classification,
      usedVisionFallback,
      usageSnapshots,
      ocrTokenizedText: ocrResult?.tokenizedText ?? '',
      ocrSource: ocrResult?.source,
      timing,
    };
  }

  isExtractedEffectivelyEmpty(classification: DocumentClassification): boolean {
    const e = classification.extracted ?? {};
    const hasPatient = !!(
      e.patient?.name ||
      e.patient?.cpf ||
      e.patient?.birthDate ||
      e.patient?.phone ||
      e.patient?.rg
    );
    const hasContext = !!(
      e.hospital ||
      e.healthPlan?.name ||
      e.diagnosis ||
      e.suggestedProcedureName ||
      (e.tuss?.length ?? 0) > 0 ||
      (e.cid?.length ?? 0) > 0 ||
      (e.opme?.length ?? 0) > 0 ||
      (e.reportSections?.length ?? 0) > 0
    );
    return !hasPatient && !hasContext;
  }

  /**
   * Quando o classificador omite CPF/telefone que o OCR já tokenizou,
   * reaproveita os placeholders `{{cpf_N}}` / `{{phone_N}}` do texto OCR
   * (ou os bindings do PII Vault) para que o detokenize devolva o valor real.
   */
  private enrichExtractedFromOcrPii(
    sessionId: string,
    extracted: DocumentClassificationExtracted,
    ocrTokenizedText: string,
  ): DocumentClassificationExtracted {
    const patient = extracted.patient;
    if (!patient?.name?.trim()) return extracted;

    const patch: NonNullable<DocumentClassificationExtracted['patient']> = {
      ...patient,
    };
    let changed = false;

    if (!patient.cpf?.trim()) {
      const cpfToken = this.resolvePiiTokenFromOcr(
        sessionId,
        ocrTokenizedText,
        'cpf',
      );
      if (cpfToken) {
        patch.cpf = cpfToken;
        changed = true;
      }
    }

    if (!patient.phone?.trim()) {
      const phoneToken = this.resolvePiiTokenFromOcr(
        sessionId,
        ocrTokenizedText,
        'phone',
      );
      if (phoneToken) {
        patch.phone = phoneToken;
        changed = true;
      }
    }

    if (!changed) return extracted;
    return { ...extracted, patient: patch };
  }

  private resolvePiiTokenFromOcr(
    sessionId: string,
    ocrTokenizedText: string,
    category: 'cpf' | 'phone',
  ): string | undefined {
    const tokenRegex = new RegExp(`\\{\\{${category}_\\d+\\}\\}`, 'g');
    const tokensInText = [...new Set(ocrTokenizedText.match(tokenRegex) ?? [])];
    if (tokensInText.length === 1) return tokensInText[0];

    if (!this.piiVault) return undefined;

    const bindings = this.piiVault
      .serializeSession(sessionId)
      .filter((binding) => binding.category === category);

    if (tokensInText.length > 1) {
      const inText = bindings.find((binding) =>
        tokensInText.includes(binding.token),
      );
      return inText?.token ?? tokensInText[0];
    }

    if (bindings.length === 1) return bindings[0].token;
    return undefined;
  }

  private detokenizeExtractedFields(
    sessionId: string,
    extracted: DocumentClassificationExtracted,
  ): DocumentClassificationExtracted {
    const dt = (v: string | undefined) =>
      v ? this.piiVault!.detokenize(sessionId, v) : v;

    return {
      ...extracted,
      hospital: dt(extracted.hospital),
      diagnosis: dt(extracted.diagnosis),
      suggestedProcedureName: dt(extracted.suggestedProcedureName),
      reportSections: extracted.reportSections?.map((section) => ({
        title: dt(section.title) ?? section.title,
        description: dt(section.description) ?? section.description,
      })),
      laudoText: dt(extracted.laudoText),
      notes: dt(extracted.notes),
      patient: extracted.patient
        ? {
            ...extracted.patient,
            name: dt(extracted.patient.name),
            cpf: dt(extracted.patient.cpf),
            phone: dt(extracted.patient.phone),
            address: dt(extracted.patient.address),
            addressNumber: dt(extracted.patient.addressNumber),
            addressComplement: dt(extracted.patient.addressComplement),
            neighborhood: dt(extracted.patient.neighborhood),
            city: dt(extracted.patient.city),
            state: dt(extracted.patient.state),
            zipCode: dt(extracted.patient.zipCode),
            rg: dt(extracted.patient.rg),
            motherName: dt(extracted.patient.motherName),
            birthDate: dt(extracted.patient.birthDate),
          }
        : undefined,
      healthPlan: extracted.healthPlan
        ? {
            ...extracted.healthPlan,
            name: dt(extracted.healthPlan.name),
            planId: dt(extracted.healthPlan.planId),
          }
        : undefined,
    };
  }
}
