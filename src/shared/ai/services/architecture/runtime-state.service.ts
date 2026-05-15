import { Injectable } from '@nestjs/common';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';
import {
  AudioCompressionResult,
  DocumentExtractionResult,
  RuntimePendingDocument,
  RuntimeState,
  RuntimeWorkflow,
} from '../../contracts/agentic-architecture.contracts';
import {
  OperationDraftType,
  REQUIRED_FIELDS_BY_TYPE,
} from '../../drafts/operation-draft.types';

@Injectable()
export class RuntimeStateService {
  build(input: {
    conversation: WhatsappConversation;
    userId: string | null;
    ownerId?: string | null;
    pendingDocument?: RuntimePendingDocument | null;
    pendingMedia?: RuntimeState['pendingMedia'];
    audioCompression?: AudioCompressionResult | null;
    documentExtraction?: DocumentExtractionResult | null;
    lastTool?: string | null;
    lastToolResult?: string | null;
  }): RuntimeState {
    const { conversation } = input;
    const memory = conversation.conversationMemory || {};
    const draft = conversation.operationDraft;
    const activeDraft = (draft?.type ?? null) as OperationDraftType | null;
    const workflow = this.resolveWorkflow({
      activeDraft,
      pendingDocument: input.pendingDocument,
      audioCompression: input.audioCompression,
      memoryIntent:
        typeof memory.intent === 'string' ? memory.intent : undefined,
    });
    const missingFields = this.resolveMissingFields(draft);
    const currentStep = draft
      ? ({
          key: draft.type,
          label: draft.type,
          status:
            draft.status === 'pending_confirmation'
              ? 'waiting'
              : draft.status === 'ready'
                ? 'ready'
                : 'collecting',
          details:
            missingFields.length > 0
              ? `Faltam: ${missingFields.join(', ')}`
              : null,
        } as const)
      : null;

    const pendingConfirmationRaw = memory.pending_confirmation as
      | RuntimeState['pendingConfirmation']
      | undefined;

    const riskFlags = [
      ...(pendingConfirmationRaw
        ? [
            {
              code: 'WAITING_CONFIRMATION' as const,
              severity: 'medium' as const,
              message: 'Ha uma confirmacao pendente aguardando o usuario.',
            },
          ]
        : []),
      ...(input.pendingDocument
        ? [
            {
              code: 'WAITING_DOCUMENT_INTENT' as const,
              severity: 'medium' as const,
              message: 'Ha um documento pendente de resolucao ou confirmacao.',
            },
          ]
        : []),
      ...(input.pendingMedia
        ? [
            {
              code: 'WAITING_MEDIA' as const,
              severity: 'medium' as const,
              message: `Aguardando midia do tipo ${input.pendingMedia.kind}.`,
            },
          ]
        : []),
      ...(missingFields.length > 0
        ? [
            {
              code: 'MISSING_REQUIRED_FIELDS' as const,
              severity: 'medium' as const,
              message: `Ainda faltam ${missingFields.length} campos obrigatorios.`,
            },
          ]
        : []),
      ...(input.audioCompression?.confidence !== null &&
      typeof input.audioCompression?.confidence === 'number' &&
      input.audioCompression.confidence < 0.7
        ? [
            {
              code: 'LOW_CONFIDENCE_AUDIO' as const,
              severity: 'medium' as const,
              message: 'A transcricao do audio veio com confianca reduzida.',
            },
          ]
        : []),
      ...(input.documentExtraction &&
      input.documentExtraction.globalConfidence < 0.7
        ? [
            {
              code: 'LOW_CONFIDENCE_DOCUMENT' as const,
              severity: 'medium' as const,
              message: 'A extracao do documento exige validacao adicional.',
            },
          ]
        : []),
    ];

    return {
      version: '1.0',
      conversationId: conversation.id,
      userId: input.userId,
      ownerId: input.ownerId ?? conversation.ownerId,
      activeWorkflow: workflow,
      activeDraft,
      currentStep,
      filledFields: {
        ...(((memory.filled_slots as Record<string, unknown>) || {}) ?? {}),
        ...(((draft?.fields as Record<string, unknown>) || {}) ?? {}),
      },
      missingFields,
      lastTool: input.lastTool ?? null,
      lastToolResult: input.lastToolResult ?? null,
      pendingConfirmation: pendingConfirmationRaw || null,
      pendingDocument: input.pendingDocument ?? null,
      pendingMedia: input.pendingMedia ?? null,
      multimodalContext:
        input.audioCompression || input.documentExtraction
          ? {
              inboundSource:
                input.audioCompression && input.documentExtraction
                  ? 'mixed'
                  : input.audioCompression
                    ? 'audio'
                    : 'pdf',
              audio: input.audioCompression ?? null,
              document: input.documentExtraction ?? null,
            }
          : null,
      riskFlags,
    };
  }

  private resolveMissingFields(
    draft: WhatsappConversation['operationDraft'],
  ): string[] {
    if (!draft) return [];
    const required = REQUIRED_FIELDS_BY_TYPE[draft.type as OperationDraftType] || [];
    const fields = ((draft.fields as Record<string, unknown>) || {}) ?? {};
    return required.filter((field) => {
      const value = fields[field];
      if (value === null || value === undefined) return true;
      if (typeof value === 'string' && !value.trim()) return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return false;
    });
  }

  private resolveWorkflow(input: {
    activeDraft: OperationDraftType | null;
    pendingDocument?: RuntimePendingDocument | null;
    audioCompression?: AudioCompressionResult | null;
    memoryIntent?: string;
  }): RuntimeWorkflow {
    if (input.pendingDocument) return 'document_intake';
    if (input.audioCompression) return 'audio_intake';
    if (input.activeDraft) {
      const map: Record<OperationDraftType, RuntimeWorkflow> = {
        create_sc: 'create_sc',
        create_patient: 'search',
        create_hospital: 'search',
        create_health_plan: 'search',
        create_procedure: 'search',
        invoice: 'invoice',
        contestation: 'contestation',
        scheduling: 'scheduling',
        update_sc: 'update_sc',
        send_sc: 'send_sc',
        start_analysis: 'start_analysis',
        accept_authorization: 'accept_authorization',
        mark_performed: 'mark_performed',
      };
      return map[input.activeDraft];
    }
    if (input.memoryIntent === 'faq') return 'faq';
    return 'idle';
  }
}
