import { Injectable, Logger, Optional } from '@nestjs/common';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';
import { hashPhone } from '../../crypto/phone-hash.util';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from '../ocr/ocr.service';
import {
  DocumentClassification,
  DocumentClassificationIntent,
} from '../ocr/document-classifier.types';
import { DocumentClassifierService } from '../ocr/document-classifier.service';
import { DocumentVisionFallbackService } from '../ocr/document-vision-fallback.service';
import {
  PendingDocumentRequest,
  WhatsappDocumentDispatcherService,
} from './whatsapp-document-dispatcher.service';

export interface ProcessPendingDocumentInput {
  phone: string;
  pending: PendingDocumentRequest;
  intent: DocumentClassificationIntent;
  conversationId: string;
  messageSid: string;
  /**
   * Identificação do usuário/owner para registro em `ai_token_usage_log`.
   * Quando ausentes, o log de uso ainda é gravado com `null` em userId/ownerId
   * (já é o padrão da entidade) — não bloqueia o pipeline.
   */
  userId?: string | null;
  ownerId?: string | null;
}

export type ProcessPendingDocumentStatus =
  | 'ok'
  | 'storage_missing'
  | 'ocr_empty'
  | 'classifier_failed';

export interface ProcessPendingDocumentOutcome {
  status: ProcessPendingDocumentStatus;
  classification?: DocumentClassification;
  /** Resumo curto pronto para virar mensagem WhatsApp ao usuário. */
  userSummary?: string;
  errorMessage?: string;
  /**
   * Indica se o resultado veio do fallback Vision (`gpt-4o`) em vez do
   * pipeline texto-OCR + classifier (`gpt-4o-mini`). Apenas para
   * observabilidade — o consumidor não precisa diferenciar.
   */
  usedVisionFallback?: boolean;
}

interface ClassifierUsageSnapshot {
  stage: 'doc_classifier' | 'doc_vision_fallback';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
}

const VISION_TRIGGER_OCR_MIN_CHARS = 30;
const VISION_TRIGGER_OCR_MIN_CONFIDENCE = 0.5;
const VISION_TRIGGER_CLASSIFIER_MIN_CONFIDENCE = 0.5;

/**
 * Orquestra o pipeline pesado quando o usuário declara intent sobre uma
 * pendência ativa: download do staging → OCR + tokenização PII → LLM
 * classificador → atualização do `PendingDocumentRequest` com a classificação
 * e o texto OCR tokenizado.
 *
 * Sprint 4 adicionou:
 *  - **Vision fallback** (`gpt-4o`) para imagens quando o OCR/classifier
 *    text-only é insuficiente (texto curto, baixa confiança ou exceção).
 *  - **`ai_token_usage_log`** com stages `doc_classifier` e
 *    `doc_vision_fallback` para auditoria de custo.
 *  - Logs estruturados `[AI_DOC_PIPELINE_*]` no caminho hot.
 *
 * Foi extraído do `AiOrchestratorService` (que já está enorme) e do
 * `WhatsappDocumentDispatcherService` (que cuida só do staging) para manter
 * cada serviço com uma responsabilidade clara.
 */
@Injectable()
export class WhatsappDocumentProcessorService {
  private readonly logger = new Logger(WhatsappDocumentProcessorService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly classifier: DocumentClassifierService,
    private readonly dispatcher: WhatsappDocumentDispatcherService,
    @Optional()
    private readonly visionFallback?: DocumentVisionFallbackService,
    @Optional()
    private readonly aiTokenUsageLogRepo?: AiTokenUsageLogRepository,
  ) {}

  async processPendingDocument(
    input: ProcessPendingDocumentInput,
  ): Promise<ProcessPendingDocumentOutcome> {
    const { phone, pending, intent, conversationId, messageSid } = input;
    const phoneMasked = this.maskPhone(phone);
    const usageSnapshots: ClassifierUsageSnapshot[] = [];

    const buffer = await this.storage.download(pending.storagePath);
    if (!buffer) {
      this.logger.warn(
        `[AI_DOC_PIPELINE] sid=${messageSid} phone=${phoneMasked} status=storage_missing path=${pending.storagePath}`,
      );
      await this.dispatcher.clearPending(phone);
      return {
        status: 'storage_missing',
        errorMessage:
          'Não consegui mais acessar o arquivo enviado (pode ter expirado). Por favor, reenvie.',
      };
    }

    let ocrResult: Awaited<ReturnType<OcrService['extractAndTokenize']>> | null;
    let ocrFailureReason: string | null = null;
    try {
      ocrResult = await this.ocr.extractAndTokenize(
        {
          buffer,
          mimeType: pending.contentType,
          filename: pending.fileName,
        },
        conversationId,
      );
    } catch (err: any) {
      ocrResult = null;
      ocrFailureReason = err?.message || 'erro desconhecido no OCR';
      this.logger.warn(
        `[AI_DOC_PIPELINE] sid=${messageSid} phone=${phoneMasked} status=ocr_exception reason=${ocrFailureReason}`,
      );
    }

    if (ocrResult) {
      this.logger.log(
        `[AI_DOC_OCR] sid=${messageSid} phone=${phoneMasked} source=${ocrResult.source} pages=${ocrResult.pagesProcessed}/${ocrResult.pageCount} confidence=${ocrResult.confidence.toFixed(2)} duration_ms=${ocrResult.durationMs} chars=${(ocrResult.text ?? '').length}`,
      );
    }

    const ocrText = ocrResult?.text?.trim() ?? '';
    const ocrTextTooShort = ocrText.length < VISION_TRIGGER_OCR_MIN_CHARS;
    const ocrConfidenceLow =
      !!ocrResult && ocrResult.confidence < VISION_TRIGGER_OCR_MIN_CONFIDENCE;
    const ocrUnusable = !ocrResult || ocrTextTooShort || ocrConfidenceLow;

    let classification: DocumentClassification | null = null;
    let classifierError: string | null = null;
    let usedVisionFallback = false;

    if (ocrResult && !ocrTextTooShort) {
      try {
        const result = await this.classifier.classifyWithUsage({
          text: ocrResult.tokenizedText,
          intent,
          messageSid,
        });
        classification = result.classification;
        usageSnapshots.push({ stage: 'doc_classifier', ...result.usage });
      } catch (err: any) {
        classifierError = err?.message || 'classifier indisponível';
        this.logger.warn(
          `[AI_DOC_PIPELINE] sid=${messageSid} phone=${phoneMasked} status=classifier_failed reason=${classifierError}`,
        );
      }
    }

    const classifierConfidenceLow =
      !!classification &&
      classification.confidence < VISION_TRIGGER_CLASSIFIER_MIN_CONFIDENCE;

    const shouldTryVisionFallback =
      this.visionFallback?.isEnabled() &&
      this.visionFallback.isSupportedImageMime(pending.contentType) &&
      (ocrUnusable || classifierError || classifierConfidenceLow);

    if (shouldTryVisionFallback && this.visionFallback) {
      const reason = ocrUnusable
        ? ocrResult
          ? ocrTextTooShort
            ? 'ocr_text_too_short'
            : 'ocr_confidence_low'
          : 'ocr_exception'
        : classifierError
          ? 'classifier_failed'
          : 'classifier_confidence_low';

      this.logger.log(
        `[AI_DOC_PIPELINE_FALLBACK] sid=${messageSid} phone=${phoneMasked} reason=${reason} mime=${pending.contentType}`,
      );

      try {
        const visionResult = await this.visionFallback.classifyImage({
          imageBuffer: buffer,
          imageMimeType: pending.contentType,
          intent,
          conversationId,
          messageSid,
        });
        classification = visionResult.classification;
        usedVisionFallback = true;
        usageSnapshots.push({
          stage: 'doc_vision_fallback',
          ...visionResult.usage,
        });
        classifierError = null;
      } catch (err: any) {
        this.logger.warn(
          `[AI_DOC_PIPELINE_FALLBACK] sid=${messageSid} phone=${phoneMasked} status=vision_failed reason=${err?.message || 'erro'}`,
        );
      }
    }

    await this.persistUsageSnapshots(
      usageSnapshots,
      conversationId,
      input.userId ?? null,
      input.ownerId ?? null,
      phone,
      messageSid,
    );

    if (!classification) {
      if (ocrUnusable && !classifierError) {
        return {
          status: 'ocr_empty',
          errorMessage: ocrFailureReason
            ? 'Tive problema para ler o conteúdo do arquivo. Tente reenviar uma versão mais nítida ou anexe pelo painel web.'
            : 'Não consegui ler texto suficiente nesse arquivo. Tente reenviar uma versão mais nítida ou anexe pelo painel web.',
        };
      }
      return {
        status: 'classifier_failed',
        errorMessage:
          'Identifiquei o conteúdo do arquivo, mas não consegui classificá-lo agora. Tente novamente em instantes.',
      };
    }

    const updatedPending: PendingDocumentRequest = {
      ...pending,
      intent,
      classification,
      classifiedAt: Date.now(),
      ocrTokenizedText: ocrResult?.tokenizedText ?? '',
    };
    await this.dispatcher.savePending(phone, updatedPending);

    this.logger.log(
      `[AI_DOC_PIPELINE_OK] sid=${messageSid} phone=${phoneMasked} kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} vision_fallback=${usedVisionFallback}`,
    );

    const userSummary = this.buildUserSummary(intent, classification);
    return {
      status: 'ok',
      classification,
      userSummary,
      usedVisionFallback,
    };
  }

  private async persistUsageSnapshots(
    snapshots: ClassifierUsageSnapshot[],
    conversationId: string,
    userId: string | null,
    ownerId: string | null,
    phone: string,
    messageSid: string,
  ): Promise<void> {
    if (!snapshots.length || !this.aiTokenUsageLogRepo) return;

    const totals = snapshots.reduce(
      (acc, snap) => {
        acc.prompt += snap.promptTokens;
        acc.completion += snap.completionTokens;
        acc.total += snap.totalTokens;
        acc.latency += snap.latencyMs;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0, latency: 0 },
    );

    const primaryModel =
      snapshots.find((s) => s.stage === 'doc_vision_fallback')?.model ??
      snapshots[0]?.model ??
      null;

    try {
      await this.aiTokenUsageLogRepo.create({
        messageSid,
        phoneHash: hashPhone(phone),
        conversationId,
        userId,
        ownerId,
        promptTokens: totals.prompt,
        completionTokens: totals.completion,
        totalTokens: totals.total,
        callsCount: snapshots.length,
        model: primaryModel,
        latencyMs: totals.latency || null,
        costEstimateCents: null,
        breakdown: snapshots,
      });
    } catch (err: any) {
      this.logger.warn(
        `Falha ao persistir AI_TOKEN_USAGE doc sid=${messageSid}: ${err?.message || 'erro desconhecido'}`,
      );
    }
  }

  /**
   * Resumo textual usado pelo dispatcher para responder ao usuário logo
   * após processar a intent. Nunca inclui dados em claro: o classifier
   * trabalha com placeholders do PII Vault.
   */
  private buildUserSummary(
    intent: DocumentClassificationIntent,
    classification: DocumentClassification,
  ): string {
    const lines: string[] = [];

    const kindLabel = this.kindLabel(classification.kind);
    lines.push(`Identifiquei o documento como: *${kindLabel}*.`);

    if (classification.confidence > 0) {
      const pct = Math.round(classification.confidence * 100);
      lines.push(`Confiança: ${pct}%.`);
    }

    const extracted = classification.extracted;
    const datapoints: string[] = [];
    if (extracted.patient?.name)
      datapoints.push(`Paciente: ${extracted.patient.name}`);
    if (extracted.patient?.cpf)
      datapoints.push(`CPF: ${extracted.patient.cpf}`);
    if (extracted.patient?.birthDate)
      datapoints.push(`Nascimento: ${extracted.patient.birthDate}`);
    if (extracted.patient?.phone)
      datapoints.push(`Telefone: ${extracted.patient.phone}`);
    if (extracted.hospital) datapoints.push(`Hospital: ${extracted.hospital}`);
    if (extracted.healthPlan?.name)
      datapoints.push(`Convênio: ${extracted.healthPlan.name}`);
    if (extracted.doctorCRM) datapoints.push(`CRM: ${extracted.doctorCRM}`);
    if (extracted.tuss?.length)
      datapoints.push(`TUSS: ${extracted.tuss.map((t) => t.code).join(', ')}`);
    if (extracted.cid?.length)
      datapoints.push(`CID: ${extracted.cid.map((c) => c.code).join(', ')}`);

    if (datapoints.length) {
      lines.push('');
      lines.push('Dados encontrados:');
      for (const dp of datapoints) lines.push(`• ${dp}`);
    }

    if (classification.ambiguity) {
      lines.push('');
      lines.push(`Atenção: ${classification.ambiguity}`);
    }

    lines.push('');
    switch (intent) {
      case 'attach':
        lines.push(
          'Para qual solicitação cirúrgica devo anexar? Me diga o protocolo (ex.: SC-1234) ou peça para listar suas SCs ativas.',
        );
        break;
      case 'create_sc':
        lines.push(
          'Vou abrir uma nova solicitação cirúrgica usando esses dados como base. Posso seguir? (responda "sim" para começar o rascunho).',
        );
        break;
      case 'create_patient':
        lines.push(
          'Posso cadastrar esse paciente agora com os dados acima? Responda "sim" para confirmar (ou complemente com telefone/e-mail se faltar).',
        );
        break;
    }

    return lines.join('\n');
  }

  private kindLabel(kind: DocumentClassification['kind']): string {
    switch (kind) {
      case 'medical_report':
        return 'Laudo médico';
      case 'exam_report':
        return 'Laudo de exame';
      case 'identity_document':
        return 'Documento de identificação';
      case 'authorization_guide':
        return 'Guia de autorização';
      case 'invoice':
        return 'Fatura / nota';
      case 'receipt':
        return 'Comprovante';
      case 'surgery_request':
        return 'Solicitação cirúrgica';
      default:
        return 'Documento (tipo não identificado)';
    }
  }

  private maskPhone(phone: string): string {
    if (!phone) return 'unknown';
    if (phone.length <= 4) return phone;
    return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
  }
}
