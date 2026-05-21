import { OperationDraftType } from '../drafts/operation-draft.types';
import { DocumentClassification } from '../ocr/document-classifier.types';

export type RuntimeWorkflow =
  | 'idle'
  | 'create_sc'
  | 'update_sc'
  | 'send_sc'
  | 'start_analysis'
  | 'accept_authorization'
  | 'mark_performed'
  | 'invoice'
  | 'contestation'
  | 'scheduling'
  | 'document_intake'
  | 'audio_intake'
  | 'signature'
  | 'faq'
  | 'search'
  | 'unknown';

export type RuntimeStepStatus =
  | 'collecting'
  | 'ready'
  | 'waiting'
  | 'executing'
  | 'completed'
  | 'error';

export interface RuntimeStepState {
  key: string;
  label: string;
  status: RuntimeStepStatus;
  details?: string | null;
}

export interface RuntimeRiskFlag {
  code:
    | 'LOW_CONFIDENCE_AUDIO'
    | 'LOW_CONFIDENCE_DOCUMENT'
    | 'MISSING_REQUIRED_FIELDS'
    | 'WAITING_CONFIRMATION'
    | 'WAITING_DOCUMENT_INTENT'
    | 'WAITING_MEDIA'
    | 'TOOL_LOOP_PRESSURE'
    | 'OCR_EMPTY'
    | 'VISION_FALLBACK_USED';
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface RuntimePendingConfirmation {
  tool: string;
  description: string;
  createdAt: string;
  args?: Record<string, unknown>;
}

export interface RuntimePendingDocument {
  storagePath: string;
  fileName: string;
  contentType: string;
  intent?: string | null;
  classification?: DocumentClassification | null;
  fingerprint?: string | null;
  expiresAt?: number | null;
}

export interface RuntimePendingMedia {
  kind: 'signature' | 'document' | 'audio' | 'unknown';
  expiresAt?: number | null;
}

export interface RuntimeMultimodalContext {
  inboundSource: 'text' | 'audio' | 'text+audio' | 'image' | 'pdf' | 'mixed';
  audio?: AudioCompressionResult | null;
  document?: DocumentExtractionResult | null;
}

export interface RuntimeState {
  version: '1.0';
  conversationId: string;
  userId: string | null;
  ownerId?: string | null;
  activeWorkflow: RuntimeWorkflow;
  activeDraft: OperationDraftType | null;
  currentStep: RuntimeStepState | null;
  filledFields: Record<string, unknown>;
  missingFields: string[];
  lastTool: string | null;
  lastToolResult: string | null;
  pendingConfirmation: RuntimePendingConfirmation | null;
  pendingDocument: RuntimePendingDocument | null;
  pendingMedia: RuntimePendingMedia | null;
  multimodalContext: RuntimeMultimodalContext | null;
  riskFlags: RuntimeRiskFlag[];
}

export interface PersistentMemorySnapshot {
  version: '1.0';
  userRole?: string | null;
  preferredWorkflows: string[];
  recurringEntities: {
    patients: Array<{ id?: string; label: string }>;
    hospitals: Array<{ id?: string; label: string }>;
    healthPlans: Array<{ id?: string; label: string }>;
    procedures: Array<{ id?: string; label: string }>;
  };
  recurrentGoals: string[];
  durableFacts: string[];
}

export interface ShortTermContextSnapshot {
  version: '1.0';
  activeTopic: string | null;
  pendingAction: string | null;
  latestUserGoal: string | null;
  relevantEvents: string[];
}

export interface SemanticInputEnvelope {
  version: '1.0';
  source: 'text' | 'audio' | 'text+audio' | 'document';
  normalizedText: string;
  rawText?: string | null;
  entities: Array<{
    type:
      | 'patient'
      | 'hospital'
      | 'health_plan'
      | 'procedure'
      | 'cid'
      | 'tuss'
      | 'email'
      | 'phone'
      | 'date'
      | 'cpf'
      | 'crm'
      | 'money'
      | 'unknown';
    value: string;
    confidence: number;
  }>;
  confidence: number;
  missingSegments: string[];
  hints: string[];
}

export interface PlannerOutput {
  version: '1.0';
  intent: string;
  workflow: RuntimeWorkflow;
  entitiesDetected: SemanticInputEnvelope['entities'];
  missingFields: string[];
  nextBestAction: string;
  toolCandidate: string | null;
  needsRetrieval: boolean;
  retrievalCategory?: string | null;
  needsVision: boolean;
  confidence: number;
  fallbackPlan: string;
}

export interface ToolStateDelta {
  workflow?: RuntimeWorkflow;
  draftType?: OperationDraftType | null;
  filledFields?: Record<string, unknown>;
  missingFields?: string[];
  pendingConfirmation?: RuntimePendingConfirmation | null;
}

export interface ToolResultEnvelope<TData = unknown> {
  status: 'ok' | 'needs_input' | 'pending_confirmation' | 'blocked' | 'error';
  message: string;
  data?: TData;
  stateDelta?: ToolStateDelta;
  retryable?: boolean;
}

export interface AudioCompressionResult {
  version: '1.0';
  fingerprint: string;
  provider: string;
  language: string | null;
  confidence: number | null;
  transcriptLength: number;
  semanticTranscript: string;
  normalizedTranscript: string;
  extractedEntities: SemanticInputEnvelope['entities'];
  inferredIntent: string | null;
  missingSegments: string[];
}

export interface DocumentExtractionResult {
  version: '1.0';
  fingerprint: string;
  classification: DocumentClassification | null;
  textLength: number;
  ocrConfidence: number | null;
  globalConfidence: number;
  fieldConfidence: Record<string, number>;
  selectiveVisionRecommended: boolean;
  reasons: string[];
}

export const RUNTIME_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'conversationId',
    'userId',
    'activeWorkflow',
    'activeDraft',
    'currentStep',
    'filledFields',
    'missingFields',
    'lastTool',
    'lastToolResult',
    'pendingConfirmation',
    'pendingDocument',
    'pendingMedia',
    'multimodalContext',
    'riskFlags',
  ],
  properties: {
    version: { type: 'string', enum: ['1.0'] },
    conversationId: { type: 'string' },
    userId: { type: ['string', 'null'] },
    activeWorkflow: { type: 'string' },
    activeDraft: { type: ['string', 'null'] },
    currentStep: { type: ['object', 'null'] },
    filledFields: { type: 'object' },
    missingFields: { type: 'array', items: { type: 'string' } },
    lastTool: { type: ['string', 'null'] },
    lastToolResult: { type: ['string', 'null'] },
    pendingConfirmation: { type: ['object', 'null'] },
    pendingDocument: { type: ['object', 'null'] },
    pendingMedia: { type: ['object', 'null'] },
    multimodalContext: { type: ['object', 'null'] },
    riskFlags: { type: 'array', items: { type: 'object' } },
  },
} as const;

export const PERSISTENT_MEMORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'preferredWorkflows',
    'recurringEntities',
    'recurrentGoals',
    'durableFacts',
  ],
  properties: {
    version: { type: 'string', enum: ['1.0'] },
    userRole: { type: ['string', 'null'] },
    preferredWorkflows: { type: 'array', items: { type: 'string' } },
    recurringEntities: { type: 'object' },
    recurrentGoals: { type: 'array', items: { type: 'string' } },
    durableFacts: { type: 'array', items: { type: 'string' } },
  },
} as const;
