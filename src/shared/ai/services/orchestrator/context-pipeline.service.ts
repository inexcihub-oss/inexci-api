import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RagService } from '../../../rag/rag.service';
import { ConversationService } from '../conversation.service';
import { ConversationContextService } from '../conversation-context.service';
import { ToolRegistryService } from '../tool-registry.service';
import { ConfirmationManagerService } from './confirmation-manager.service';
import { DraftContextService } from './draft-context.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { NextStepAdvisorService } from './next-step-advisor.service';
import { PiiBindingService } from './pii-binding.service';
import { ClearContextDetectorService } from './clear-context-detector.service';
import { OrchestratorTelemetryService } from './orchestrator-telemetry.service';
import { DocumentIntakeService } from './document-intake.service';
import { ToolLoopHooks } from './tool-loop-runner.service';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { ToolContext } from '../../tools/tool.interface';
import {
  ContextBlockBreakdown,
  ContextStrategy,
} from '../conversation-context.service';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';
import { User } from '../../../../database/entities/user.entity';
import { WhatsappDocumentDispatcherService } from '../whatsapp-document-dispatcher.service';
import { ContextAssemblerService } from '../architecture/context-assembler.service';
import { DocumentIntelligenceService } from '../architecture/document-intelligence.service';
import { InternalPlannerService } from '../architecture/internal-planner.service';
import { RetrievalPolicyService } from '../architecture/retrieval-policy.service';
import { RuntimeStateService } from '../architecture/runtime-state.service';
import { RagHybridSearchService } from '../rag/rag-hybrid-search.service';
import { PlannerService } from '../planner/planner.service';
import { InputPipelineOutcome } from './input-pipeline.service';
import { InboundMessageData } from './message-processor.service';

export interface InitialCompletionMeta {
  breakdown: ContextBlockBreakdown;
  strategy: ContextStrategy;
  toolsCount: number;
  draftType: OperationDraftType | null;
  cacheKey: string;
  tier: string;
  operation: string;
  plannerIntent: string;
  retrievalMode: 'hybrid' | 'vector' | 'none';
  extractionSource: string | null;
  rag: ReturnType<RagService['computeMetrics']> | null;
}

export interface ContextPipelineResult {
  messages: OpenAI.ChatCompletionMessageParam[];
  tools: OpenAI.ChatCompletionTool[];
  activeDraftType: OperationDraftType | null;
  promptCacheKey: string;
  toolContext: ToolContext;
  telemetryMeta: InitialCompletionMeta;
}

/**
 * Monta o contexto completo que precede a chamada inicial ao LLM:
 * runtime state, planner, retrieval decision, RAG, montagem das mensagens,
 * injeção de hints (confirmação, numérico, documento), seleção de tools.
 *
 * Também expõe `buildLoopHooks` para que o orchestrator não precise
 * injetar DraftContextService, ConversationMemoryService, NextStepAdvisorService
 * e PiiBindingService diretamente.
 *
 * Extraído de `AiOrchestratorService` para reduzir o tamanho do
 * coordenador principal.
 */
@Injectable()
export class ContextPipelineService {
  private readonly logger = new Logger(ContextPipelineService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly contextService: ConversationContextService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly ragService: RagService,
    private readonly confirmationManager: ConfirmationManagerService,
    private readonly draftContext: DraftContextService,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly nextStepAdvisor: NextStepAdvisorService,
    private readonly piiBindingService: PiiBindingService,
    private readonly clearContextDetector: ClearContextDetectorService,
    private readonly telemetry: OrchestratorTelemetryService,
    private readonly documentIntakeService: DocumentIntakeService,
    private readonly configService: ConfigService,
    @Optional() private readonly documentDispatcher?: WhatsappDocumentDispatcherService,
    @Optional() private readonly contextAssembler?: ContextAssemblerService,
    @Optional() private readonly documentIntelligence?: DocumentIntelligenceService,
    @Optional() private readonly internalPlanner?: InternalPlannerService,
    @Optional() private readonly retrievalPolicy?: RetrievalPolicyService,
    @Optional() private readonly runtimeStateService?: RuntimeStateService,
    @Optional() private readonly ragHybridSearch?: RagHybridSearchService,
    @Optional() private readonly plannerService?: PlannerService,
  ) {}

  private isFeatureEnabled(key: string, defaultValue = true): boolean {
    const raw = String(
      this.configService.get<string>(key, defaultValue ? 'true' : 'false'),
    )
      .trim()
      .toLowerCase();
    return raw === 'true' || raw === '1';
  }

  async prepare(params: {
    data: InboundMessageData;
    phone: string;
    conversation: WhatsappConversation;
    accessibleDoctorIds: string[];
    userId: string;
    ownerId: string | null;
    user: User;
    input: Exclude<InputPipelineOutcome, { handled: true }>;
    piiVaultRef: import('../pii-vault.service').PiiVaultService;
  }): Promise<ContextPipelineResult> {
    const {
      data,
      phone,
      conversation,
      accessibleDoctorIds,
      userId,
      ownerId,
      user,
      input,
      piiVaultRef,
    } = params;
    const { userInputForAi, effectiveBody, normalizedInput, semanticInput, audioCompression } =
      input;

    // --- Pending document state ---
    const pendingDocument = this.documentDispatcher
      ? await this.documentDispatcher.getPending(phone)
      : null;

    const pendingDocumentState =
      this.documentIntelligence &&
      this.isFeatureEnabled('AI_ARCHITECTURE_RUNTIME_ENABLED')
        ? this.documentIntelligence.buildPendingDocumentState({
            pending: pendingDocument,
            fingerprint: pendingDocument?.classification
              ? `pending:${pendingDocument.messageSid}`
              : null,
          })
        : null;

    const awaitingMedia =
      typeof (this.conversationMemory as any).getAwaitingMedia === 'function'
        ? await (this.conversationMemory as any).getAwaitingMedia(conversation.id)
        : null;

    // --- Runtime state ---
    const runtimeState =
      this.runtimeStateService &&
      this.isFeatureEnabled('AI_ARCHITECTURE_RUNTIME_ENABLED')
        ? this.runtimeStateService.build({
            conversation,
            userId,
            ownerId,
            pendingDocument: pendingDocumentState,
            pendingMedia: awaitingMedia
              ? { kind: awaitingMedia.kind, expiresAt: awaitingMedia.expiresAt }
              : null,
            audioCompression,
          })
        : {
            version: '1.0' as const,
            conversationId: conversation.id,
            userId,
            ownerId,
            activeWorkflow: 'idle' as const,
            activeDraft: conversation.operationDraft?.type ?? null,
            currentStep: null,
            filledFields: {},
            missingFields: [],
            lastTool: null,
            lastToolResult: null,
            pendingConfirmation:
              ((conversation.conversationMemory || {}).pending_confirmation as any) ?? null,
            pendingDocument: pendingDocumentState,
            pendingMedia: awaitingMedia
              ? { kind: awaitingMedia.kind, expiresAt: awaitingMedia.expiresAt }
              : null,
            multimodalContext: null,
            riskFlags: [],
          };

    // --- Planner ---
    const plannerOutput =
      this.plannerService &&
      this.isFeatureEnabled('AI_ARCHITECTURE_PLANNER_ENABLED')
        ? await this.plannerService.plan({ normalizedInput, semanticInput, runtimeState })
        : this.internalPlanner &&
            this.isFeatureEnabled('AI_ARCHITECTURE_PLANNER_ENABLED')
          ? this.internalPlanner.plan({ normalizedInput, semanticInput, runtimeState })
          : {
              version: '1.0' as const,
              intent: 'unknown',
              workflow: runtimeState.activeWorkflow,
              entitiesDetected: semanticInput.entities,
              missingFields: runtimeState.missingFields,
              nextBestAction: 'Responder com o menor proximo passo necessario.',
              toolCandidate: null,
              needsRetrieval: userInputForAi.trim().length >= 15,
              retrievalCategory: null,
              needsVision: false,
              confidence: 0.5,
              fallbackPlan: 'Pedir contexto adicional ao usuario.',
            };

    // --- Retrieval decision ---
    const retrievalDecision =
      this.retrievalPolicy &&
      this.isFeatureEnabled('AI_ARCHITECTURE_PLANNER_ENABLED')
        ? this.retrievalPolicy.decide({
            normalizedInput,
            userInput: userInputForAi,
            planner: plannerOutput,
            runtimeState,
          })
        : {
            shouldQuery:
              userInputForAi.trim().length >= 15 &&
              !this.clearContextDetector.isConfirmationInput(normalizedInput) &&
              !this.clearContextDetector.isCancelConfirmationInput(normalizedInput) &&
              !/^[0-9]{1,2}$/.test(normalizedInput) &&
              !this.clearContextDetector.isClearContextCommand(normalizedInput),
            rewrittenQuery: userInputForAi,
            category: undefined as string | undefined,
            reason: 'legacy_fallback',
          };

    if (
      this.isFeatureEnabled('AI_ARCHITECTURE_TELEMETRY_ENABLED') &&
      (this.telemetry as any).logArchitectureDecision
    ) {
      (this.telemetry as any).logArchitectureDecision({
        messageSid: data.messageSid,
        phone,
        runtimeState,
        planner: plannerOutput,
        retrieval: retrievalDecision,
      });
    }

    if (!retrievalDecision.shouldQuery) {
      this.logger.debug(
        `[RAG] sid=${data.messageSid} skipped=true reason=${retrievalDecision.reason}`,
      );
    }

    // --- RAG search ---
    const ragResults = retrievalDecision.shouldQuery
      ? this.ragHybridSearch && this.isFeatureEnabled('AI_RAG_HYBRID_ENABLED')
        ? await this.ragHybridSearch.search({
            query: retrievalDecision.rewrittenQuery,
            category: retrievalDecision.category,
            limit: this.configService.get<number>('AI_RAG_TOP_K', 5),
          })
        : ((await (retrievalDecision.category
            ? this.ragService.search(retrievalDecision.rewrittenQuery, {
                category: retrievalDecision.category,
              })
            : this.ragService.search(retrievalDecision.rewrittenQuery))) ?? [])
      : [];

    const ragMetrics = retrievalDecision.shouldQuery
      ? this.ragService.computeMetrics(ragResults as any)
      : null;
    const ragContext = retrievalDecision.shouldQuery
      ? await this.ragService.formatContext(ragResults as any)
      : null;

    // --- Reload conversation + doctors info ---
    const updatedConv = await this.conversationService.getOrCreateConversation(
      phone,
      userId,
      ownerId,
    );
    const accessibleDoctorsInfo =
      await this.conversationMemory.resolveDoctorsInfo(accessibleDoctorIds);

    // --- Build context (messages array) ---
    const userInfo = {
      id: userId,
      name: user?.name ?? null,
      role: user?.role ?? null,
      isDoctor: Boolean(user?.doctorProfile?.id) || Boolean((user as any)?.isDoctor),
      ownerId,
      accessibleDoctors: accessibleDoctorsInfo,
    };

    const built =
      this.contextAssembler && this.isFeatureEnabled('AI_ARCHITECTURE_CONTEXT_ENABLED')
        ? await this.contextAssembler.buildContext({
            conversation: updatedConv,
            ragContext: ragContext || null,
            userInfo,
            runtimeState,
            planner: plannerOutput,
            audioCompression,
            pendingDocument: pendingDocumentState,
          })
        : await this.contextService.buildContext({
            conversation: updatedConv,
            ragContext: ragContext || null,
            userInfo,
          });

    const messages: OpenAI.ChatCompletionMessageParam[] = built.messages;

    // --- Inject system hints ---
    const numericHint = await this.confirmationManager.buildNumericChoiceHint(
      conversation.id,
      effectiveBody || '',
    );
    if (numericHint)
      this.injectSystemHint(messages, numericHint, 'NUMERIC_CHOICE', data.messageSid, conversation.id);

    const confirmationHint = await this.confirmationManager.buildPendingConfirmationHint(
      conversation.id,
      effectiveBody || '',
    );
    if (confirmationHint)
      this.injectSystemHint(
        messages,
        confirmationHint,
        'PENDING_CONFIRMATION',
        data.messageSid,
        conversation.id,
      );

    const documentHint = await this.documentIntakeService.buildDocumentPendingHint(phone);
    if (documentHint)
      this.injectSystemHint(
        messages,
        documentHint,
        'AI_DOC_PENDING_HINT',
        data.messageSid,
        conversation.id,
      );

    // --- Tool selection ---
    const initialDraftCtx = await this.draftContext.buildToolsForDraft(conversation.id);
    const tools =
      typeof (this.toolRegistry as any).getToolDefinitionsForIntent === 'function'
        ? (this.toolRegistry as any).getToolDefinitionsForIntent({
            activeDraftType: initialDraftCtx.draftType,
            intent: plannerOutput.intent,
            requiresConfirmation: Boolean(runtimeState.pendingConfirmation),
          })
        : initialDraftCtx.tools;

    const activeDraftType = initialDraftCtx.draftType;
    const promptCacheKey = this.draftContext.buildCacheKey(activeDraftType);

    const toolContext: ToolContext = {
      userId,
      phone,
      accessibleDoctorIds,
      ownerId,
      conversationId: conversation.id,
      inboundMedia: data.media || [],
      piiVault: piiVaultRef,
    };

    const telemetryMeta: InitialCompletionMeta = {
      breakdown: built.breakdown,
      strategy: built.strategy,
      toolsCount: tools.length,
      draftType: activeDraftType,
      cacheKey: promptCacheKey,
      tier: 'legacy',
      operation: 'whatsapp_orchestrator_initial',
      plannerIntent: plannerOutput.intent,
      retrievalMode: retrievalDecision.shouldQuery
        ? this.ragHybridSearch && this.isFeatureEnabled('AI_RAG_HYBRID_ENABLED')
          ? 'hybrid'
          : 'vector'
        : 'none',
      extractionSource: pendingDocumentState?.classification?.model?.includes('vision')
        ? 'vision'
        : pendingDocumentState?.classification
          ? 'ocr_or_classifier'
          : null,
      rag: ragMetrics,
    };

    return { messages, tools, activeDraftType, promptCacheKey, toolContext, telemetryMeta };
  }

  /**
   * Constrói os hooks do tool loop sem exigir que o orchestrator injete
   * DraftContextService, ConversationMemoryService, NextStepAdvisorService
   * e PiiBindingService individualmente.
   */
  buildLoopHooks(opts: {
    conversationId: string;
    messageSid: string;
    getResponseMaxTokens: () => number;
    getRemainingTimeoutMs: (started: number, total: number) => number;
  }): ToolLoopHooks {
    const { conversationId, messageSid, getResponseMaxTokens, getRemainingTimeoutMs } = opts;
    return {
      evaluatePlanFirstGuard: (toolCalls) =>
        this.draftContext.evaluatePlanFirstGuard(toolCalls, conversationId),
      memorizeEntitiesFromToolCall: (input) =>
        this.conversationMemory.memorizeEntities(input),
      appendNextStepIfNeeded: (functionName, args, output, ctx) =>
        this.nextStepAdvisor.appendNextStep(functionName, args, output, ctx),
      redactResidualPii: (msgs) =>
        this.piiBindingService.redactResidualPii(msgs, { conversationId, messageSid }),
      buildToolsForCurrentDraft: (convId) =>
        this.draftContext.buildToolsForDraft(convId),
      buildPromptCacheKey: (draftType) => this.draftContext.buildCacheKey(draftType),
      getResponseMaxTokens,
      getRemainingTimeoutMs,
    };
  }

  private injectSystemHint(
    messages: OpenAI.ChatCompletionMessageParam[],
    hint: string,
    tag: string,
    messageSid: string,
    convId: string,
  ): void {
    const insertAt = messages.findIndex((m) => m.role !== 'system');
    messages.splice(insertAt === -1 ? messages.length : insertAt, 0, {
      role: 'system',
      content: hint,
    });
    this.logger.log(`[${tag}] sid=${messageSid} conv=${convId} injected=true`);
  }
}
