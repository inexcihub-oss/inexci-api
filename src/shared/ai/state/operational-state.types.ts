import { OperationDraftType } from '../drafts/operation-draft.types';

/**
 * Operational State (Fase 2 do Blueprint v3).
 *
 * JSON compacto enviado ao LLM como uma única `system` message
 * (`OPERATIONAL_STATE: <json>`). Substitui os blocos textuais
 * "USUÁRIO ATUAL", "SC EM CONSTRUÇÃO", "CONFIRMAÇÃO PENDENTE",
 * "DOCUMENTO PENDENTE" e "ESCOLHA NUMÉRICA" que hoje são montados
 * como prosa em `ConversationContextService.buildContext`.
 *
 * Princípios:
 *   - Imutável dentro de um turno.
 *   - SEM PII em texto livre — só placeholders/IDs.
 *   - SEM regras de negócio — essas vão para os módulos de prompt.
 *   - Cada campo é independente; a serialização canônica é
 *     `JSON.stringify(state)` — o `cacheKey` cobre apenas os
 *     campos estáveis (workflow + multimodal).
 */
export interface OperationalStateTurn {
  phoneMasked: string;
  userId: string;
  userName: string | null;
  userRole: 'admin' | 'collaborator' | null;
  isDoctor: boolean;
  ownerId: string | null;
  doctorIdsAccessible: string[];
  /** Quando o usuário é médico, este é o seu próprio doctorId. */
  selfDoctorId: string | null;
  channel: 'whatsapp';
}

export interface OperationalStateActiveWorkflow {
  name: OperationDraftType;
  status: 'collecting' | 'ready' | 'pending_confirmation' | 'committing';
  startedAt: string;
  /** Campos já preenchidos no draft (usados para evitar re-perguntar). */
  fieldsFilled: string[];
  /** Próximos campos requeridos pelo schema (ordem de preenchimento). */
  fieldsPending: string[];
  /** Sub-draft em curso? Quando aplicável. */
  parentType?: OperationDraftType;
}

export interface OperationalStateLastAction {
  tool: string;
  resultStatus: 'ok' | 'pending_confirmation' | 'error' | 'need_input';
  summary: string;
}

export interface OperationalStatePendingConfirmation {
  tool: string;
  argsRedacted: Record<string, unknown>;
  expiresAt: string;
  /** Mini-instrução determinística (ex.: "se sim, reexecute com confirm:true"). */
  instruction: string;
}

export interface OperationalStateAwaitingMedia {
  kind: 'doctor_signature' | 'laudo_pdf' | 'attach_document';
  expiresAt: string;
}

export interface OperationalStateDocPending {
  intent: 'create_sc' | 'attach' | 'create_patient' | null;
  ocrConfidence: number;
  classifierKind: string | null;
  extractedSummary: string;
}

export interface OperationalStateAudioPending {
  /** Hash sha256 (evita re-injetar transcript quando há cache). */
  hash?: string;
  intentHint: string | null;
  /**
   * Resumo curto da fala (Fase 4: Semantic Compression). Quando ausente
   * indica que o LLM tem o transcript literal na mensagem user.
   */
  summary?: string;
  entities?: Record<string, unknown>;
}

export interface OperationalStateMultimodalContext {
  docPending: OperationalStateDocPending | null;
  audioPending: OperationalStateAudioPending | null;
}

export interface OperationalStateNumericChoice {
  /**
   * Última lista de opções numeradas exibida ao usuário, quando a turn
   * anterior ofereceu "1 - …", "2 - …", "3 - …". Permite mapeamento
   * determinístico de respostas curtas como "1", "opção 2".
   */
  options: string[];
}

export interface OperationalState {
  turn: OperationalStateTurn;
  activeWorkflow: OperationalStateActiveWorkflow | null;
  lastAction: OperationalStateLastAction | null;
  pendingConfirmation: OperationalStatePendingConfirmation | null;
  awaitingMedia: OperationalStateAwaitingMedia | null;
  multimodalContext: OperationalStateMultimodalContext;
  numericChoice: OperationalStateNumericChoice | null;
  /** Hints de memória persistente (Fase 6). */
  persistentHints?: Record<string, unknown>;
}
