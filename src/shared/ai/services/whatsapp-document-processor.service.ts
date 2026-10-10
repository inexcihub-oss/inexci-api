import { Injectable, Logger, Optional } from '@nestjs/common';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';
import { hashPhone } from '../../crypto/phone-hash.util';
import { StorageService } from '../../storage/storage.service';
import {
  DocumentClassification,
  DocumentClassificationIntent,
} from '../ocr/document-classifier.types';
import {
  DocumentExtractionService,
  ClassifierUsageSnapshot,
} from '../ocr/document-extraction.service';
import {
  PendingDocumentRequest,
  WhatsappDocumentDispatcherService,
} from './whatsapp-document-dispatcher.service';
import { OperationDraftService } from './operation-draft.service';
import { errorMessage } from '../../utils/error-message.util';

export interface ProcessPendingDocumentInput {
  phone: string;
  pending: PendingDocumentRequest;
  intent: DocumentClassificationIntent;
  conversationId: string;
  messageSid: string;
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
  userSummary?: string;
  errorMessage?: string;
  usedVisionFallback?: boolean;
}

@Injectable()
export class WhatsappDocumentProcessorService {
  private readonly logger = new Logger(WhatsappDocumentProcessorService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly extractor: DocumentExtractionService,
    private readonly dispatcher: WhatsappDocumentDispatcherService,
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

    const extracted = await this.extractor.extractFromBuffer({
      buffer,
      mimeType: pending.contentType,
      filename: pending.fileName,
      sessionId: conversationId,
      intent,
    });

    this.logger.log(
      `[AI_DOC_PIPELINE] sid=${messageSid} phone=${phoneMasked} status=${extracted.status} vision_fallback=${extracted.usedVisionFallback}`,
    );

    await this.persistUsageSnapshots(
      extracted.usageSnapshots,
      conversationId,
      input.userId ?? null,
      input.ownerId ?? null,
      phone,
      messageSid,
    );

    if (!extracted.classification) {
      if (
        extracted.status === 'ocr_empty' ||
        extracted.status === 'ocr_exception'
      ) {
        return {
          status: 'ocr_empty',
          errorMessage:
            extracted.status === 'ocr_exception'
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

    const { classification, usedVisionFallback } = extracted;

    const updatedPending: PendingDocumentRequest = {
      ...pending,
      intent,
      classification,
      classifiedAt: Date.now(),
      ocrTokenizedText: extracted.ocrTokenizedText ?? '',
    };
    await this.dispatcher.savePending(phone, updatedPending);

    this.logger.log(
      `[AI_DOC_PIPELINE_OK] sid=${messageSid} phone=${phoneMasked} kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} vision_fallback=${usedVisionFallback}`,
    );

    if (intent === 'create_sc' && this.draftService) {
      try {
        await this.prefillCreateScDraftFromClassification({
          conversationId,
          classification,
          messageSid,
          phoneMasked,
        });
      } catch (err) {
        this.logger.warn(
          `[AI_DOC_PREFILL] sid=${messageSid} phone=${phoneMasked} status=failed reason=${errorMessage(err) || 'erro'}`,
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

  private async prefillCreateScDraftFromClassification(opts: {
    conversationId: string;
    classification: DocumentClassification;
    messageSid: string;
    phoneMasked: string;
  }): Promise<void> {
    if (!this.draftService) return;
    const { conversationId, classification } = opts;
    const extracted = classification.extracted || {};

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
      patch.patientLabel = extracted.patient.name;
    }
    if (isUsable(extracted.suggestedProcedureName)) {
      patch.procedureLabel = extracted.suggestedProcedureName;
    }
    if (isUsable(extracted.hospital)) {
      patch.hospitalLabel = extracted.hospital;
    }
    if (isUsable(extracted.healthPlan?.name)) {
      patch.healthPlanLabel = extracted.healthPlan.name;
    }
    if (isUsable(extracted.laudoText)) {
      patch.notes = extracted.laudoText;
    }
    if (Array.isArray(extracted.tuss) && extracted.tuss.length > 0) {
      patch.tussItems = extracted.tuss
        .filter((t) => t?.code)
        .map((t) => ({
          code: String(t.code),
          description: isUsable(t.description) ? t.description : undefined,
        }));
    }
    if (Array.isArray(extracted.opme) && extracted.opme.length > 0) {
      patch.opmeItems = extracted.opme
        .filter((o) => o?.description)
        .map((o) => ({
          description: String(o.description),
          qty: typeof o.qty === 'number' && o.qty > 0 ? o.qty : 1,
          supplier: isUsable(o.supplier) ? o.supplier : undefined,
          manufacturer: isUsable(o.manufacturer) ? o.manufacturer : undefined,
        }));
    }
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
    } catch (err) {
      this.logger.warn(
        `Falha ao persistir AI_TOKEN_USAGE doc sid=${messageSid}: ${errorMessage(err) || 'erro desconhecido'}`,
      );
    }
  }

  private buildUserSummary(
    intent: DocumentClassificationIntent,
    classification: DocumentClassification,
  ): string {
    const lines: string[] = [];

    const kindLabel = this.kindLabel(classification.kind);
    lines.push(`Identifiquei o documento como: *${kindLabel}*.`);

    const extracted = classification.extracted;
    const datapoints: string[] = [];

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
      datapoints.push(`Paciente: ${extracted.patient.name}`);
    if (isUsable(extracted.patient?.birthDate))
      datapoints.push(`Nascimento: ${extracted.patient.birthDate}`);
    if (isUsable(extracted.hospital))
      datapoints.push(`Hospital: ${extracted.hospital}`);
    if (isUsable(extracted.healthPlan?.name))
      datapoints.push(`Convênio: ${extracted.healthPlan.name}`);
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
        const supplierBits = [o.supplier, o.manufacturer]
          .filter(Boolean)
          .join(' / ');
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

    const isEmpty = this.extractor.isExtractedEffectivelyEmpty(classification);

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
