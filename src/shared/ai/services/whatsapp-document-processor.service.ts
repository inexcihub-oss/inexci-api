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
import { OperationDraftService } from './operation-draft.service';

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
const VISION_TRIGGER_OCR_MIN_CONFIDENCE = 0.6;
// Limiar inclusivo: classifier que devolve confidence == 0.5 (caso clássico
// "não sei, chuto meio-termo") cai no fallback. Sem isso o pipeline fica
// preso em "Documento (tipo não identificado) — Confiança: 50%".
const VISION_TRIGGER_CLASSIFIER_MAX_CONFIDENCE = 0.6;

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
    @Optional()
    private readonly draftService?: OperationDraftService,
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
      if (ocrResult.warnings?.length) {
        this.logger.log(
          `[AI_DOC_OCR_WARNINGS] sid=${messageSid} phone=${phoneMasked} warnings=${ocrResult.warnings.join('|')}`,
        );
      }
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
        try {
          this.logger.log(
            `[AI_DOC_CLASSIFIER_RESULT] sid=${messageSid} phone=${phoneMasked} stage=text_only kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} extracted=${JSON.stringify(classification.extracted ?? {})}`,
          );
        } catch {
          /* JSON.stringify nunca deve falhar aqui, mas guardamos por segurança. */
        }
      } catch (err: any) {
        classifierError = err?.message || 'classifier indisponível';
        this.logger.warn(
          `[AI_DOC_PIPELINE] sid=${messageSid} phone=${phoneMasked} status=classifier_failed reason=${classifierError}`,
        );
      }
    }

    // Sinais que disparam Vision fallback:
    //  1. confidence baixa (<= threshold; inclusivo para pegar o "0.5" clássico).
    //  2. classifier devolveu `unknown` mesmo com confidence alta —
    //     significa que o LLM viu o texto mas não conseguiu classificar
    //     (PDF escaneado, OCR com ruído, layout não convencional).
    //  3. `extracted` totalmente vazio — sem nome de paciente, hospital,
    //     TUSS, CID, OPME, nem CRM. Sem nada útil é equivalente a "unknown"
    //     para o fluxo, então tentamos Vision para ver se ele pega algo.
    const classifierConfidenceLow =
      !!classification &&
      classification.confidence <= VISION_TRIGGER_CLASSIFIER_MAX_CONFIDENCE;
    const classifierKindUnknown =
      !!classification && classification.kind === 'unknown';
    const classifierExtractedEmpty =
      !!classification && this.isExtractedEffectivelyEmpty(classification);

    const isPdf =
      (pending.contentType || '').toLowerCase() === 'application/pdf';
    const isImage = this.visionFallback?.isSupportedImageMime(
      pending.contentType,
    );

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
      `[AI_DOC_PIPELINE_SIGNALS] sid=${messageSid} phone=${phoneMasked} ` +
        `vision_enabled=${visionEnabled} mime_supported=${!!isImage || !!isPdf} ` +
        `ocr_unusable=${ocrUnusable} classifier_error=${!!classifierError} ` +
        `classifier_confidence_low=${classifierConfidenceLow} classifier_kind_unknown=${classifierKindUnknown} classifier_extracted_empty=${classifierExtractedEmpty} ` +
        `=> will_try_vision=${shouldTryVisionFallback}`,
    );

    if (shouldTryVisionFallback && this.visionFallback) {
      const reason = ocrUnusable
        ? ocrResult
          ? ocrTextTooShort
            ? 'ocr_text_too_short'
            : 'ocr_confidence_low'
          : 'ocr_exception'
        : classifierError
          ? 'classifier_failed'
          : classifierConfidenceLow
            ? 'classifier_confidence_low'
            : classifierKindUnknown
              ? 'classifier_kind_unknown'
              : 'classifier_extracted_empty';

      this.logger.log(
        `[AI_DOC_PIPELINE_FALLBACK] sid=${messageSid} phone=${phoneMasked} reason=${reason} mime=${pending.contentType}`,
      );

      // Para PDFs, rasterizamos a primeira página antes de mandar pro
      // Vision (que aceita só imagens). PDFs com mais páginas ainda têm o
      // classifier text-only do `getText` cobrindo o conteúdo todo — o
      // Vision aqui só compensa OCR ruim na primeira página.
      let visionImageBuffer: Buffer | null = buffer;
      let visionMimeType = pending.contentType;
      if (isPdf) {
        visionImageBuffer = await this.ocr.rasterizeFirstPdfPage(buffer);
        visionMimeType = 'image/png';
        if (!visionImageBuffer) {
          this.logger.warn(
            `[AI_DOC_PIPELINE_FALLBACK] sid=${messageSid} phone=${phoneMasked} status=vision_failed reason=pdf_rasterize_failed`,
          );
        }
      }

      if (visionImageBuffer) {
        try {
          const visionResult = await this.visionFallback.classifyImage({
            imageBuffer: visionImageBuffer,
            imageMimeType: visionMimeType,
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
          try {
            this.logger.log(
              `[AI_DOC_CLASSIFIER_RESULT] sid=${messageSid} phone=${phoneMasked} stage=vision_fallback kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} extracted=${JSON.stringify(classification.extracted ?? {})}`,
            );
          } catch {
            /* ignore */
          }
        } catch (err: any) {
          this.logger.warn(
            `[AI_DOC_PIPELINE_FALLBACK] sid=${messageSid} phone=${phoneMasked} status=vision_failed reason=${err?.message || 'erro'}`,
          );
        }
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

    // Pré-preenche o draft `create_sc` direto a partir da classificação,
    // sem depender do LLM seguir 11 passos de prompt. Isso garante que
    // notes/tussItems/opmeItems já estejam no draft no momento do commit
    // — corrige o bug de "SC criada vazia" reportado pelo usuário.
    if (intent === 'create_sc' && this.draftService) {
      try {
        await this.prefillCreateScDraftFromClassification({
          conversationId,
          classification,
          messageSid,
          phoneMasked,
        });
      } catch (err: any) {
        this.logger.warn(
          `[AI_DOC_PREFILL] sid=${messageSid} phone=${phoneMasked} status=failed reason=${err?.message || 'erro'}`,
        );
      }
    }

    const userSummary = this.buildUserSummary(intent, classification);
    return {
      status: 'ok',
      classification,
      userSummary,
      usedVisionFallback,
    };
  }

  /**
   * Pré-preenche o draft `create_sc` ativo (cria um novo, se não existir)
   * com os dados estruturados extraídos do documento — laudo, TUSS, OPME,
   * labels de paciente/hospital/convênio/procedimento e prioridade default
   * (`LOW`). IDs reais (patientId, procedureId, hospitalId, healthPlanId)
   * NÃO são preenchidos aqui — ficam para o LLM resolver via tools de
   * lookup. Mas as labels já no draft permitem que o `sc_draft_preview`
   * mostre algo útil mesmo se o LLM ainda não chamou nenhuma tool.
   */
  private async prefillCreateScDraftFromClassification(opts: {
    conversationId: string;
    classification: DocumentClassification;
    messageSid: string;
    phoneMasked: string;
  }): Promise<void> {
    if (!this.draftService) return;
    const { conversationId, classification } = opts;
    const extracted = classification.extracted || {};

    // Abre o draft (idempotente: retoma o existente).
    const current = await this.draftService.getCurrent(conversationId);
    if (!current || current.type !== 'create_sc') {
      await this.draftService.start({
        conversationId,
        type: 'create_sc',
      });
    }

    const patch: Record<string, unknown> = {};
    const isUsable = (v: unknown): v is string =>
      typeof v === 'string' &&
      !!v.trim() &&
      !['null', 'undefined', 'n/a'].includes(v.trim().toLowerCase());

    if (isUsable(extracted.patient?.name)) {
      patch.patientLabel = extracted.patient!.name;
    }
    if (isUsable(extracted.suggestedProcedureName)) {
      patch.procedureLabel = extracted.suggestedProcedureName;
    }
    if (isUsable(extracted.hospital)) {
      patch.hospitalLabel = extracted.hospital;
    }
    if (isUsable(extracted.healthPlan?.name)) {
      patch.healthPlanLabel = extracted.healthPlan!.name;
    }
    if (isUsable(extracted.laudoText)) {
      patch.notes = extracted.laudoText;
    }
    if (Array.isArray(extracted.tuss) && extracted.tuss.length > 0) {
      patch.tussItems = extracted.tuss
        .filter((t: any) => t?.code)
        .map((t: any) => ({
          code: String(t.code),
          description: isUsable(t.description) ? t.description : undefined,
        }));
    }
    if (Array.isArray(extracted.opme) && extracted.opme.length > 0) {
      patch.opmeItems = extracted.opme
        .filter((o: any) => o?.description)
        .map((o: any) => ({
          description: String(o.description),
          qty: typeof o.qty === 'number' && o.qty > 0 ? o.qty : 1,
          supplier: isUsable(o.supplier) ? o.supplier : undefined,
          brand: isUsable(o.brand) ? o.brand : undefined,
        }));
    }
    // Prioridade default: LOW. Não sobrescreve se o LLM já gravou outra.
    const refreshed = await this.draftService.getCurrent(conversationId);
    if (refreshed && refreshed.type === 'create_sc') {
      const existing = refreshed.fields as Record<string, unknown>;
      if (!existing.priority) patch.priority = 'LOW';
    }

    if (Object.keys(patch).length === 0) return;
    await this.draftService.setFields(conversationId, 'create_sc', patch);

    this.logger.log(
      `[AI_DOC_PREFILL] sid=${opts.messageSid} phone=${opts.phoneMasked} status=ok keys=${Object.keys(patch).join(',')} tuss=${Array.isArray(patch.tussItems) ? (patch.tussItems as unknown[]).length : 0} opme=${Array.isArray(patch.opmeItems) ? (patch.opmeItems as unknown[]).length : 0} laudo=${typeof patch.notes === 'string' ? patch.notes.length : 0}`,
    );
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

    // Confidence é usada apenas internamente (gate do Vision fallback,
    // logs, métricas). Não a expomos ao usuário para não poluir a UX.

    const extracted = classification.extracted;
    const datapoints: string[] = [];

    // O classifier pode retornar valores não-úteis ("null", "undefined",
    // strings vazias) quando o documento não tem aquele campo. Filtramos
    // tudo isso para não vazar "Hospital: null" para o usuário.
    const isUsable = (v: unknown): v is string => {
      if (typeof v !== 'string') return false;
      const trimmed = v.trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return (
        lower !== 'null' &&
        lower !== 'undefined' &&
        lower !== 'n/a' &&
        lower !== 'nao informado' &&
        lower !== 'não informado'
      );
    };

    if (isUsable(extracted.patient?.name))
      datapoints.push(`Paciente: ${extracted.patient!.name}`);
    // CPF, telefone e e-mail chegam tokenizados pelo PII Vault
    // (ex.: {{cpf_3}}) — nunca os incluímos na mensagem visível ao usuário.
    // Eles ficam disponíveis no hint interno (buildDocumentPendingHint) para
    // que o LLM os repasse às tools de cadastro/draft.
    if (isUsable(extracted.patient?.birthDate))
      datapoints.push(`Nascimento: ${extracted.patient!.birthDate}`);
    if (isUsable(extracted.hospital))
      datapoints.push(`Hospital: ${extracted.hospital}`);
    if (isUsable(extracted.healthPlan?.name))
      datapoints.push(`Convênio: ${extracted.healthPlan!.name}`);
    if (isUsable(extracted.diagnosis))
      datapoints.push(`Diagnóstico: ${extracted.diagnosis}`);
    if (isUsable(extracted.suggestedProcedureName))
      datapoints.push(
        `Procedimento sugerido: ${extracted.suggestedProcedureName}`,
      );
    if (extracted.tuss?.length) {
      datapoints.push(
        `TUSS (${extracted.tuss.length}): ${extracted.tuss
          .map((t) => `${t.code}${t.description ? ` — ${t.description}` : ''}`)
          .join('; ')}`,
      );
    }
    if (extracted.cid?.length)
      datapoints.push(`CID: ${extracted.cid.map((c) => c.code).join(', ')}`);
    if (extracted.opme?.length) {
      const opmeLines = extracted.opme.map((o) => {
        const supplierBits = [o.supplier, o.brand].filter(Boolean).join(' / ');
        const suffix = supplierBits ? ` [${supplierBits}]` : '';
        return `${o.qty}× ${o.description}${suffix}`;
      });
      datapoints.push(
        `OPME (${extracted.opme.length}): ${opmeLines.join('; ')}`,
      );
    }
    if (extracted.suggestedSuppliers?.length) {
      datapoints.push(
        `Fornecedores sugeridos: ${extracted.suggestedSuppliers.join(', ')}`,
      );
    }
    if (extracted.laudoText) {
      const preview =
        extracted.laudoText.length > 220
          ? `${extracted.laudoText.slice(0, 220)}…`
          : extracted.laudoText;
      datapoints.push(`Laudo (trecho): "${preview}"`);
    }

    if (datapoints.length) {
      lines.push('');
      lines.push('Dados encontrados:');
      for (const dp of datapoints) lines.push(`• ${dp}`);
    }

    if (classification.ambiguity) {
      lines.push('');
      lines.push(`Atenção: ${classification.ambiguity}`);
    }

    // Quando o classifier (texto OU vision) não conseguiu extrair nada
    // acionável, encerramos o turno com um pedido objetivo em vez de
    // prometer "vou abrir uma SC" — assim o usuário sabe que precisa
    // digitar os dados manualmente.
    const isEmpty = this.isExtractedEffectivelyEmpty(classification);

    lines.push('');
    if (isEmpty) {
      switch (intent) {
        case 'attach':
          lines.push(
            'Não consegui extrair dados úteis desse arquivo automaticamente. Me diga o protocolo da SC (ex.: SC-1234) onde anexar — eu junto o arquivo mesmo sem extrair os campos.',
          );
          break;
        case 'create_sc':
          lines.push(
            'Não consegui extrair dados úteis desse arquivo automaticamente. Para começar a SC, me diga pelo menos o nome do paciente — eu sigo daí.',
          );
          break;
        case 'create_patient':
          lines.push(
            'Não consegui extrair dados úteis desse arquivo automaticamente. Para cadastrar o paciente, me diga o nome completo, telefone e e-mail.',
          );
          break;
      }
      return lines.join('\n');
    }

    // Sinaliza ao usuário se temos dados RICOS o bastante para já avançar
    // sem confirmação intermediária. O LLM, com o `buildDocumentPendingHint`
    // injetado no system prompt, vai começar o draft IMEDIATAMENTE no
    // próximo turno (ou já no mesmo) e o usuário só confirma o commit final.
    const hasRichScData =
      intent === 'create_sc' && this.hasRichSurgeryRequestData(classification);

    switch (intent) {
      case 'attach':
        lines.push(
          'Para qual solicitação cirúrgica devo anexar? Me diga o protocolo (ex.: SC-1234) ou peça para listar suas SCs ativas.',
        );
        break;
      case 'create_sc':
        if (hasRichScData) {
          lines.push(
            'Já vou montar a solicitação cirúrgica com TODOS esses dados (paciente, convênio, procedimento, TUSS, OPME e laudo). Te mostro o resumo final antes de salvar — se algo estiver errado, é só me corrigir.',
          );
        } else {
          lines.push(
            'Vou abrir uma nova solicitação cirúrgica usando esses dados como base. Posso seguir? (responda "sim" para começar o rascunho).',
          );
        }
        break;
      case 'create_patient':
        lines.push(
          'Posso cadastrar esse paciente agora com os dados acima? Responda "sim" para confirmar (ou complemente com telefone/e-mail se faltar).',
        );
        break;
    }

    return lines.join('\n');
  }

  /**
   * Detecta documentos com dados suficientes para POPULAR uma SC sem
   * perguntar nada além da confirmação final. Critério: paciente
   * identificado + (procedimento sugerido OU pelo menos 1 TUSS) + (algum
   * contexto extra: convênio OU OPME OU diagnóstico OU laudo).
   * Usado para mudar o tom da mensagem ao usuário (de "Posso seguir?"
   * para "Já vou montar tudo") e ativar o caminho rápido no hint do LLM.
   */
  private hasRichSurgeryRequestData(
    classification: DocumentClassification,
  ): boolean {
    const e = classification.extracted ?? {};
    const hasPatient = !!(e.patient?.name && e.patient.name.length > 1);
    const hasProcedure =
      !!e.suggestedProcedureName || (e.tuss?.length ?? 0) > 0;
    const hasContext =
      !!e.healthPlan?.name ||
      (e.opme?.length ?? 0) > 0 ||
      !!e.diagnosis ||
      !!e.laudoText;
    return hasPatient && hasProcedure && hasContext;
  }

  /**
   * Considera o resultado do classifier como "vazio" se ele não trouxe
   * nenhum dado clínico/pessoal acionável. Sem essa heurística o pipeline
   * aceitava classificações como `kind=medical_report, extracted={}` —
   * pareciam OK no log mas o LLM não tinha nada para popular o draft.
   */
  private isExtractedEffectivelyEmpty(
    classification: DocumentClassification,
  ): boolean {
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
      (e.opme?.length ?? 0) > 0
    );
    return !hasPatient && !hasContext;
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
