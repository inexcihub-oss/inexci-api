import { Injectable } from '@nestjs/common';
import {
  ConversationMemory,
  WhatsappConversation,
} from '../../../database/entities/whatsapp-conversation.entity';
import {
  OperationDraft,
  REQUIRED_FIELDS_BY_TYPE,
} from '../drafts/operation-draft.types';
import {
  OperationalState,
  OperationalStateActiveWorkflow,
  OperationalStateAudioPending,
  OperationalStateAwaitingMedia,
  OperationalStateDocPending,
  OperationalStateLastAction,
  OperationalStateMultimodalContext,
  OperationalStateNumericChoice,
  OperationalStatePendingConfirmation,
  OperationalStateTurn,
} from './operational-state.types';

export interface OperationalStateInput {
  conversation: WhatsappConversation;
  user: {
    id: string;
    name?: string | null;
    role?: 'admin' | 'collaborator' | null;
    isDoctor: boolean;
    ownerId: string | null;
    selfDoctorId: string | null;
    accessibleDoctorIds: string[];
  };
  /** Mascarado pelo `PhoneNormalizerService.maskPhone`. */
  phoneMasked: string;
  /** Última lista numerada exibida ao usuário (Fase 2). */
  numericChoiceOptions?: string[];
  /** Pending de documento — vem do `DocumentIntakeService` no turno. */
  docPending?: OperationalStateDocPending | null;
  /** Pending de áudio (Fase 4). */
  audioPending?: OperationalStateAudioPending | null;
  /** Resultado da última tool (passado pelo orchestrator). */
  lastAction?: OperationalStateLastAction | null;
}

/**
 * Builder puro do `OperationalState`. Sem dependências de OpenAI; pode ser
 * usado tanto pelo orchestrator (Fase 2) como por testes ou subagentes
 * (Fase 3 — Planner).
 *
 * Estratégia: lê do `WhatsappConversation` (fonte de verdade) + entradas
 * voláteis do turno (`docPending`, `audioPending`, `numericChoiceOptions`).
 */
@Injectable()
export class OperationalStateBuilder {
  build(input: OperationalStateInput): OperationalState {
    const turn = this.buildTurn(input);
    const draft = input.conversation.operationDraft;
    const memory = input.conversation.conversationMemory ?? {};

    return {
      turn,
      activeWorkflow: this.buildActiveWorkflow(draft),
      lastAction: input.lastAction ?? null,
      pendingConfirmation: this.buildPendingConfirmation(memory),
      awaitingMedia: this.buildAwaitingMedia(memory),
      multimodalContext: this.buildMultimodalContext(input),
      numericChoice: this.buildNumericChoice(input.numericChoiceOptions),
    };
  }

  /**
   * Serialização canônica enviada ao LLM. Mantemos `JSON.stringify`
   * sem `undefined` para deixar o prompt determinístico (mesma entrada
   * = mesmo hash de prompt cache).
   */
  serialize(state: OperationalState): string {
    return `OPERATIONAL_STATE: ${JSON.stringify(state)}`;
  }

  /**
   * Chave usada no `prompt_cache_key` da OpenAI. Cobre **somente** os
   * campos estáveis dentro de um draft; campos voláteis (last_action,
   * pending_confirmation, fields_filled) NÃO entram para evitar
   * invalidar o cache em todo turno.
   */
  cacheKey(state: OperationalState): string {
    const wf = state.activeWorkflow?.name ?? 'none';
    const docKind = state.multimodalContext.docPending?.classifierKind ?? 'none';
    const audio = state.multimodalContext.audioPending ? 'audio' : 'none';
    return `wf=${wf}|doc=${docKind}|aud=${audio}`;
  }

  private buildTurn(input: OperationalStateInput): OperationalStateTurn {
    return {
      phoneMasked: input.phoneMasked,
      userId: input.user.id,
      userName: input.user.name ?? null,
      userRole: input.user.role ?? null,
      isDoctor: input.user.isDoctor,
      ownerId: input.user.ownerId,
      selfDoctorId: input.user.selfDoctorId,
      doctorIdsAccessible: input.user.accessibleDoctorIds,
      channel: 'whatsapp',
    };
  }

  private buildActiveWorkflow(
    draft: OperationDraft | null,
  ): OperationalStateActiveWorkflow | null {
    if (!draft) return null;
    const required = REQUIRED_FIELDS_BY_TYPE[draft.type] ?? [];
    const filled: string[] = [];
    const pending: string[] = [];

    for (const field of required) {
      const value = (draft.fields as Record<string, unknown>)[field];
      if (value === null || value === undefined || value === '') {
        pending.push(field);
      } else {
        filled.push(field);
      }
    }

    return {
      name: draft.type,
      status: draft.status,
      startedAt: draft.startedAt,
      fieldsFilled: filled,
      fieldsPending: pending,
      ...(draft.parent ? { parentType: draft.parent.type } : {}),
    };
  }

  private buildPendingConfirmation(
    memory: ConversationMemory,
  ): OperationalStatePendingConfirmation | null {
    const pc = memory.pending_confirmation;
    if (!pc) return null;

    // TTL local (15 min) — alinhado ao ConfirmationManagerService.
    const created = Date.parse(pc.createdAt);
    if (Number.isFinite(created)) {
      const ageMs = Date.now() - created;
      if (ageMs > 15 * 60 * 1000) return null;
    }

    return {
      tool: pc.tool,
      argsRedacted: this.redactArgs(pc.args ?? {}),
      expiresAt: new Date(
        (Number.isFinite(created) ? created : Date.now()) + 15 * 60 * 1000,
      ).toISOString(),
      instruction:
        'Se usuário confirmar (sim/ok/dígito da opção), reexecute a tool com confirm:true e os mesmos args.',
    };
  }

  private buildAwaitingMedia(
    memory: ConversationMemory,
  ): OperationalStateAwaitingMedia | null {
    const am = memory.awaitingMedia as
      | { kind?: string; expiresAt?: string }
      | undefined;
    if (!am || !am.kind) return null;
    const validKinds = ['doctor_signature', 'laudo_pdf', 'attach_document'];
    if (!validKinds.includes(am.kind)) return null;
    return {
      kind: am.kind as OperationalStateAwaitingMedia['kind'],
      expiresAt: am.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  private buildMultimodalContext(
    input: OperationalStateInput,
  ): OperationalStateMultimodalContext {
    return {
      docPending: input.docPending ?? null,
      audioPending: input.audioPending ?? null,
    };
  }

  private buildNumericChoice(
    options: string[] | undefined,
  ): OperationalStateNumericChoice | null {
    if (!options || options.length === 0) return null;
    return { options: options.slice(0, 3) };
  }

  /**
   * Remove valores claramente sensíveis dos args de pending_confirmation
   * antes de mandar ao LLM. Mantém chaves para preservar a forma do
   * comando, valores são marcados como "<redacted>" quando suspeitos.
   */
  private redactArgs(
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const SUSPICIOUS = ['cpf', 'phone', 'email', 'token', 'password'];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (SUSPICIOUS.some((s) => k.toLowerCase().includes(s))) {
        out[k] = '<redacted>';
      } else if (typeof v === 'string' && v.length > 200) {
        out[k] = `${v.slice(0, 200)}…`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
