import { Injectable, Logger } from '@nestjs/common';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import {
  DraftFieldsByType,
  DRAFT_TYPE_LABELS,
  OperationDraft,
  OperationDraftStatus,
  OperationDraftType,
  REQUIRED_FIELDS_BY_TYPE,
} from '../drafts/operation-draft.types';

export interface StartDraftOptions<T extends OperationDraftType> {
  conversationId: string;
  type: T;
  /**
   * Quando este é um sub-draft (ex.: `create_patient` aberto durante
   * `create_sc`), referência ao pai para que ao commitar voltemos a ele.
   */
  parent?: {
    type: OperationDraftType;
    returnField: string;
    snapshot: unknown;
  };
}

export interface DraftValidationResult<T extends OperationDraftType> {
  isReady: boolean;
  missing: string[];
  draft: OperationDraft<T> | null;
}

/**
 * Service que gerencia o ciclo de vida do `operation_draft` em
 * `whatsapp_conversations`. As tools `*_draft_set_*` chamam este service,
 * nunca tocam a entidade direto.
 */
@Injectable()
export class OperationDraftService {
  private readonly logger = new Logger(OperationDraftService.name);

  constructor(
    private readonly conversationRepo: WhatsappConversationRepository,
  ) {}

  /**
   * Inicia um novo draft do tipo informado para a conversa. Se já houver
   * draft ativo de outro tipo, ele é PRESERVADO como `parent.snapshot`
   * somente quando `parent` foi explicitamente passado (sub-draft).
   * Caso contrário, o draft antigo é descartado (assume troca de fluxo).
   */
  async start<T extends OperationDraftType>(
    opts: StartDraftOptions<T>,
  ): Promise<OperationDraft<T>> {
    const now = new Date().toISOString();
    const fields = {} as DraftFieldsByType[T];
    const draft: OperationDraft<T> = {
      type: opts.type,
      startedAt: now,
      updatedAt: now,
      status: 'collecting',
      fields,
      ...(opts.parent ? { parent: opts.parent } : {}),
    };
    await this.conversationRepo.update(opts.conversationId, {
      operationDraft: draft,
    } as any);
    return draft;
  }

  /**
   * Recupera o draft atual da conversa, sem assumir tipo.
   */
  async getCurrent(conversationId: string): Promise<OperationDraft | null> {
    const conversation = await this.conversationRepo.findOne({
      id: conversationId,
    } as any);
    return (conversation?.operationDraft as OperationDraft | undefined) ?? null;
  }

  /**
   * Recupera o draft atual da conversa esperando um tipo específico.
   * Retorna `null` se não houver draft ou se o tipo não bater.
   */
  async getCurrentOfType<T extends OperationDraftType>(
    conversationId: string,
    type: T,
  ): Promise<OperationDraft<T> | null> {
    const draft = await this.getCurrent(conversationId);
    if (!draft) return null;
    if (draft.type !== type) return null;
    return draft as OperationDraft<T>;
  }

  /**
   * Atualiza um campo do draft. Cria o draft se ainda não existir e
   * `autoStartType` foi informado.
   */
  async setField<T extends OperationDraftType>(
    conversationId: string,
    type: T,
    field: keyof DraftFieldsByType[T] & string,
    value: unknown,
  ): Promise<OperationDraft<T>> {
    let draft = await this.getCurrentOfType(conversationId, type);
    if (!draft) {
      draft = await this.start({ conversationId, type });
    }
    const updatedFields = {
      ...(draft.fields as object),
      [field]: value,
    } as DraftFieldsByType[T];
    const updated: OperationDraft<T> = {
      ...draft,
      fields: updatedFields,
      updatedAt: new Date().toISOString(),
      status: 'collecting',
    };
    await this.conversationRepo.update(conversationId, {
      operationDraft: updated,
    } as any);
    return updated;
  }

  /**
   * Atualiza múltiplos campos do draft de uma vez.
   */
  async setFields<T extends OperationDraftType>(
    conversationId: string,
    type: T,
    patch: Partial<DraftFieldsByType[T]>,
  ): Promise<OperationDraft<T>> {
    let draft = await this.getCurrentOfType(conversationId, type);
    if (!draft) {
      draft = await this.start({ conversationId, type });
    }
    const updatedFields = {
      ...(draft.fields as object),
      ...(patch as object),
    } as DraftFieldsByType[T];
    const updated: OperationDraft<T> = {
      ...draft,
      fields: updatedFields,
      updatedAt: new Date().toISOString(),
      status: 'collecting',
    };
    await this.conversationRepo.update(conversationId, {
      operationDraft: updated,
    } as any);
    return updated;
  }

  /**
   * Define o status do draft (collecting → ready → pending_confirmation →
   * committing). Não muda os campos.
   */
  async setStatus(
    conversationId: string,
    type: OperationDraftType,
    status: OperationDraftStatus,
  ): Promise<OperationDraft | null> {
    const draft = await this.getCurrentOfType(conversationId, type);
    if (!draft) return null;
    const updated: OperationDraft = {
      ...draft,
      status,
      updatedAt: new Date().toISOString(),
    };
    await this.conversationRepo.update(conversationId, {
      operationDraft: updated,
    } as any);
    return updated;
  }

  /**
   * Valida campos obrigatórios. Retorna `isReady=true` quando todos foram
   * preenchidos.
   */
  async validate<T extends OperationDraftType>(
    conversationId: string,
    type: T,
  ): Promise<DraftValidationResult<T>> {
    const draft = await this.getCurrentOfType(conversationId, type);
    if (!draft) {
      return {
        isReady: false,
        missing: REQUIRED_FIELDS_BY_TYPE[type],
        draft: null,
      };
    }
    const required = REQUIRED_FIELDS_BY_TYPE[type];
    const fields = draft.fields as Record<string, unknown>;
    const missing = required.filter((field) => {
      const v = fields[field];
      if (v === undefined || v === null) return true;
      if (typeof v === 'string' && v.trim() === '') return true;
      if (Array.isArray(v) && v.length === 0) return true;
      if (typeof v === 'object' && Object.keys(v as object).length === 0) {
        return true;
      }
      return false;
    });
    return {
      isReady: missing.length === 0,
      missing,
      draft,
    };
  }

  /**
   * Gera um preview textual em pt-BR do draft atual. Não muda o status.
   * Quando `setPendingConfirmation=true` (default), também grava status
   * `pending_confirmation`.
   */
  async getPreview<T extends OperationDraftType>(
    conversationId: string,
    type: T,
    setPendingConfirmation = true,
  ): Promise<{ text: string; draft: OperationDraft<T> | null }> {
    const draft = await this.getCurrentOfType(conversationId, type);
    if (!draft) {
      return { text: 'Nenhum rascunho ativo para este fluxo.', draft: null };
    }
    const label = DRAFT_TYPE_LABELS[type];
    const lines = [`*${label} — preview:*`];
    const fields = draft.fields as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === '') continue;
      lines.push(`${prettifyKey(key)}: ${formatValue(value)}`);
    }
    lines.push('', 'Responda "sim" para confirmar ou "não" para cancelar.');
    const text = lines.join('\n');

    let finalDraft: OperationDraft<T> = draft;
    if (setPendingConfirmation) {
      const updated = await this.setStatus(
        conversationId,
        type,
        'pending_confirmation',
      );
      if (updated) finalDraft = updated as OperationDraft<T>;
    }

    return { text, draft: finalDraft };
  }

  /**
   * Cancela o draft atual (remove operation_draft).
   */
  async cancel(conversationId: string): Promise<void> {
    await this.conversationRepo.update(conversationId, {
      operationDraft: null,
    } as any);
  }

  /**
   * Após commit, libera o draft. Se havia `parent`, retomamos o pai com o
   * `returnField` populado pelo valor commitado (`commitResult.id` por
   * convenção).
   */
  async finalizeCommit(
    conversationId: string,
    commitResult: { id?: string; label?: string },
  ): Promise<OperationDraft | null> {
    const draft = await this.getCurrent(conversationId);
    if (!draft) return null;

    if (draft.parent) {
      const parentSnapshot = draft.parent.snapshot as OperationDraft | null;
      if (parentSnapshot) {
        const updatedParent: OperationDraft = {
          ...parentSnapshot,
          fields: {
            ...(parentSnapshot.fields as object),
            [draft.parent.returnField]: commitResult.id,
            ...(commitResult.label
              ? {
                  [`${draft.parent.returnField.replace(/Id$/, '')}Label`]:
                    commitResult.label,
                }
              : {}),
          } as any,
          status: 'collecting',
          updatedAt: new Date().toISOString(),
        };
        await this.conversationRepo.update(conversationId, {
          operationDraft: updatedParent,
        } as any);
        return updatedParent;
      }
    }

    await this.conversationRepo.update(conversationId, {
      operationDraft: null,
    } as any);
    return null;
  }
}

function prettifyKey(key: string): string {
  const lookup: Record<string, string> = {
    patientLabel: 'Paciente',
    patientId: 'Paciente (id)',
    doctorLabel: 'Médico',
    doctorId: 'Médico (id)',
    procedureLabel: 'Procedimento',
    procedureId: 'Procedimento (id)',
    hospitalLabel: 'Hospital',
    hospitalId: 'Hospital (id)',
    healthPlanLabel: 'Convênio',
    healthPlanId: 'Convênio (id)',
    priority: 'Prioridade',
    preferredDates: 'Datas sugeridas',
    notes: 'Observações',
    name: 'Nome',
    cpf: 'CPF',
    phone: 'Telefone',
    email: 'E-mail',
    birthDate: 'Nascimento',
    gender: 'Sexo',
    surgeryRequestId: 'Solicitação (id)',
    surgeryRequestLabel: 'Solicitação',
    invoiceProtocol: 'Protocolo do convênio',
    invoiceValue: 'Valor',
    invoiceSentAt: 'Data de envio',
    paymentDeadline: 'Prazo de pagamento',
    setAsDefaultForHealthPlan: 'Definir prazo como padrão do convênio',
    contestationType: 'Tipo de contestação',
    reason: 'Motivo',
    method: 'Método de envio',
    to: 'Destinatário',
    subject: 'Assunto',
    message: 'Mensagem',
    attachments: 'Anexos',
    dateOptions: 'Opções de data',
    confirmedDate: 'Data confirmada',
    confirmedDateIndex: 'Opção confirmada',
    scope: 'Escopo',
    changes: 'Alterações',
    requestNumber: 'Nº da solicitação (operadora)',
    receivedAt: 'Data de recebimento',
    quotation1Number: 'Cotação 1 — Nº',
    quotation1ReceivedAt: 'Cotação 1 — Data',
    quotation2Number: 'Cotação 2 — Nº',
    quotation2ReceivedAt: 'Cotação 2 — Data',
    quotation3Number: 'Cotação 3 — Nº',
    quotation3ReceivedAt: 'Cotação 3 — Data',
    notifyPatient: 'Notificar paciente',
    surgeryPerformedAt: 'Data da cirurgia',
  };
  return lookup[key] ?? key;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
