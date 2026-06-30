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

export interface ExtractFromBufferOutput {
  status: ExtractFromBufferStatus;
  classification: DocumentClassification | null;
  usedVisionFallback: boolean;
  usageSnapshots: ClassifierUsageSnapshot[];
  /** Texto OCR já tokenizado pelo PII Vault (quando disponível). */
  ocrTokenizedText: string;
  errorReason?: string;
}

const VISION_TRIGGER_OCR_MIN_CHARS = 30;
const VISION_TRIGGER_MIN_CONFIDENCE = 0.75;

/**
 * Pipeline puro de extração de documento a partir de um buffer.
 * Orquestra: OCR → tokenização PII → classificação (gpt-4o-mini) → Vision
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

    let ocrResult: Awaited<ReturnType<OcrService['extractAndTokenize']>> | null;
    let ocrFailureReason: string | null = null;
    try {
      ocrResult = await this.ocr.extractAndTokenize(
        { buffer, mimeType, filename },
        sessionId,
      );
    } catch (err: any) {
      ocrResult = null;
      ocrFailureReason = err?.message || 'erro desconhecido no OCR';
      this.logger.warn(
        `[DOC_EXTRACT] sid=${sessionId} status=ocr_exception reason=${ocrFailureReason}`,
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
      try {
        const result = await this.classifier.classifyWithUsage({
          text: ocrResult.tokenizedText,
          intent,
          messageSid: sessionId,
        });
        classification = result.classification;
        usageSnapshots.push({ stage: 'doc_classifier', ...result.usage });
        this.logger.log(
          `[DOC_EXTRACT] sid=${sessionId} stage=text_only kind=${classification.kind} confidence=${classification.confidence.toFixed(2)}`,
        );
      } catch (err: any) {
        classifierError = err?.message || 'classifier indisponível';
        this.logger.warn(
          `[DOC_EXTRACT] sid=${sessionId} status=classifier_failed reason=${classifierError}`,
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

    const shouldTryVisionFallback =
      visionEnabled &&
      (isImage || isPdf) &&
      (ocrUnusable ||
        classifierError ||
        classifierConfidenceLow ||
        classifierKindUnknown ||
        classifierExtractedEmpty);

    this.logger.log(
      `[DOC_EXTRACT] sid=${sessionId} vision_enabled=${visionEnabled} mime_supported=${!!isImage || isPdf} ocr_unusable=${ocrUnusable} classifier_confidence_low=${classifierConfidenceLow} => will_try_vision=${shouldTryVisionFallback}`,
    );

    if (shouldTryVisionFallback && this.visionFallback) {
      let visionImageBuffer: Buffer | null = buffer;
      let visionMimeType = mimeType;
      if (isPdf) {
        visionImageBuffer = await this.ocr.rasterizeFirstPdfPage(buffer);
        visionMimeType = 'image/png';
        if (!visionImageBuffer) {
          this.logger.warn(
            `[DOC_EXTRACT] sid=${sessionId} status=vision_failed reason=pdf_rasterize_failed`,
          );
        }
      }

      if (visionImageBuffer) {
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
          usageSnapshots.push({
            stage: 'doc_vision_fallback',
            ...visionResult.usage,
          });
          classifierError = null;
          this.logger.log(
            `[DOC_EXTRACT] sid=${sessionId} stage=vision_fallback kind=${classification.kind} confidence=${classification.confidence.toFixed(2)}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[DOC_EXTRACT] sid=${sessionId} status=vision_failed reason=${err?.message || 'erro'}`,
          );
        }
      }
    }

    if (!classification) {
      if (ocrUnusable && !classifierError) {
        return {
          status: ocrFailureReason ? 'ocr_exception' : 'ocr_empty',
          classification: null,
          usedVisionFallback: false,
          usageSnapshots,
          ocrTokenizedText: '',
          errorReason: ocrFailureReason ?? 'texto insuficiente no documento',
        };
      }
      return {
        status: 'classifier_failed',
        classification: null,
        usedVisionFallback: false,
        usageSnapshots,
        ocrTokenizedText: ocrResult?.tokenizedText ?? '',
        errorReason: classifierError ?? 'classificador indisponível',
      };
    }

    if (input.detokenizeExtracted && this.piiVault) {
      classification = {
        ...classification,
        extracted: this.detokenizeExtractedFields(
          sessionId,
          classification.extracted,
        ),
      };
    }

    return {
      status: 'ok',
      classification,
      usedVisionFallback,
      usageSnapshots,
      ocrTokenizedText: ocrResult?.tokenizedText ?? '',
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
