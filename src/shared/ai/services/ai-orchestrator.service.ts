import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { setRequestContext } from 'src/shared/logging/request-context';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { ConversationService } from './conversation.service';
import {
  BuildContextResult,
  ConversationContextService,
} from './conversation-context.service';
import { PiiVaultService } from './pii-vault.service';
import { RagQueryMetrics, RagService } from '../../rag/rag.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { AccessControlService } from '../../services/access-control.service';
import { ToolContext } from '../tools/tool.interface';
import { WhatsappMediaService } from '../../whatsapp/whatsapp-media.service';
import { WHATSAPP_TEMPLATES } from '../../whatsapp/whatsapp-templates.constants';
import { DocumentIntakeService } from './orchestrator/document-intake.service';
import { AudioIntakeService } from './orchestrator/audio-intake.service';
import { PiiBindingService } from './orchestrator/pii-binding.service';
import { ConversationMemoryService } from './orchestrator/conversation-memory.service';
import { NextStepAdvisorService } from './orchestrator/next-step-advisor.service';
import { DraftContextService } from './orchestrator/draft-context.service';
import { ResponseNormalizerService } from './orchestrator/response-normalizer.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { ClearContextDetectorService } from './orchestrator/clear-context-detector.service';
import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import {
  CompletionUsageSnapshot,
  OrchestratorTelemetryService,
} from './orchestrator/orchestrator-telemetry.service';
import { ToolLoopRunnerService } from './orchestrator/tool-loop-runner.service';
import {
  InboundMessageData,
  MessageProcessorService,
} from './orchestrator/message-processor.service';
import { inexciTracer, SpanStatusCode } from '../../observability/tracer';
import { recordAiProcessingDuration } from '../../observability/metrics.util';
import { SimpleCache } from '../utils/simple-cache';
import { OperationDraftType } from '../drafts/operation-draft.types';
import { Permission, permissionsOf } from '../../permissions';
import { MAX_RESPONSE_LENGTH } from '../constants/ai.constants';
import { User } from '../../../database/entities/user.entity';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';
import { errorMessage } from '../../utils/error-message.util';

interface TurnTiming {
  startedAt: number;
  timeoutMs: number;
}

interface TurnIdentity {
  phone: string;
  maskedPhone: string;
  user: User;
  userId: string;
  ownerId: string | null;
  accessibleDoctorIds: string[];
  isDoctor: boolean;
  permissions: Permission[];
}

interface TurnInput {
  effectiveBody: string;
  normalizedInput: string;
  userInputForAi: string;
}

interface TurnModelContext {
  messages: OpenAI.ChatCompletionMessageParam[];
  tools: OpenAI.ChatCompletionTool[];
  activeDraftType: OperationDraftType | null;
  breakdown: BuildContextResult['breakdown'];
  strategy: BuildContextResult['strategy'];
  ragMetrics: RagQueryMetrics | null;
}

interface TurnLoopOutcome {
  responseMessage: OpenAI.ChatCompletionMessage;
  activeDraftType: OperationDraftType | null;
  loopLimitReached: boolean;
  pendingToolNames: string[];
  hadTools: boolean;
}

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);
  private readonly doctorIdsCache = new SimpleCache<string[]>();

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly conversationService: ConversationService,
    private readonly ragService: RagService,
    private readonly whatsappService: WhatsappService,
    private readonly accessControlService: AccessControlService,
    private readonly configService: ConfigService,
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly piiVault: PiiVaultService,
    private readonly contextService: ConversationContextService,
    private readonly responseNormalizer: ResponseNormalizerService,
    private readonly phoneNormalizer: PhoneNormalizerService,
    private readonly clearContextDetector: ClearContextDetectorService,
    private readonly confirmationManager: ConfirmationManagerService,
    private readonly telemetry: OrchestratorTelemetryService,
    private readonly toolLoopRunner: ToolLoopRunnerService,
    private readonly messageProcessor: MessageProcessorService,
    private readonly documentIntakeService: DocumentIntakeService,
    private readonly audioIntakeService: AudioIntakeService,
    private readonly piiBindingService: PiiBindingService,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly nextStepAdvisor: NextStepAdvisorService,
    private readonly draftContext: DraftContextService,
  ) {}

  private getResponseMaxTokens(): number {
    const value = this.configService.get<number>('AI_RESPONSE_MAX_TOKENS', 450);
    return Math.max(60, Math.floor(Number(value) || 450));
  }

  private buildLoopLimitFallback(
    pendingToolNames: string[],
    activeDraftType: OperationDraftType | null,
  ): string {
    const lastTool = pendingToolNames[pendingToolNames.length - 1] ?? '';

    if (lastTool.startsWith('send_sc_draft') || activeDraftType === 'send_sc') {
      return 'Tive uma dificuldade técnica para concluir o envio da solicitação. Posso tentar de novo? Se preferir, me diga o método (e-mail ou download).';
    }
    if (lastTool.startsWith('sc_draft') || activeDraftType === 'create_sc') {
      return 'Tive uma dificuldade técnica para finalizar a criação da solicitação. Me diga se quer que eu tente de novo ou se prefere ajustar algum dado antes.';
    }
    if (lastTool.startsWith('invoice_draft') || activeDraftType === 'invoice') {
      return 'Tive uma dificuldade técnica para registrar a fatura. Quer que eu tente novamente?';
    }
    if (
      lastTool.startsWith('contestation_draft') ||
      activeDraftType === 'contestation'
    ) {
      return 'Tive uma dificuldade técnica para registrar a contestação. Quer que eu tente de novo?';
    }
    if (
      lastTool.startsWith('scheduling_draft') ||
      activeDraftType === 'scheduling'
    ) {
      return 'Tive uma dificuldade técnica para registrar o agendamento. Posso tentar de novo?';
    }
    if (lastTool === 'upload_doctor_signature') {
      return 'Não consegui concluir o upload da assinatura agora. Me envie a foto novamente e eu registro.';
    }

    return 'Tive uma dificuldade técnica para concluir essa ação. Me diga em poucas palavras o que precisa e eu sigo daí.';
  }

  private sanitizeAssistantOutputForHistory(
    text: string,
    conversationId: string,
    messageSid: string,
  ): string {
    if (!text) return text;
    const result = this.piiVault.maskLiteralPii(text);
    if (result.masked.length) {
      const breakdown = result.masked
        .map((entry) => `${entry.category}=${entry.count}`)
        .join(',');
      this.logger.warn(
        `[AI_ASSISTANT_PII_MASK] sid=${messageSid} conv=${conversationId} ${breakdown}`,
      );
    }
    return this.responseNormalizer.collapseSCPrefixes(
      result.text,
      conversationId,
      messageSid,
    );
  }

  invalidateUserCacheByPhone(phone: string | null | undefined): void {
    this.messageProcessor.invalidateUserCacheByPhone(phone);
  }

  @OnEvent('user.access_changed')
  onUserAccessChanged(payload: {
    userId: string;
    phone?: string | null;
  }): void {
    this.doctorIdsCache.delete(payload.userId);
    this.accessControlService.invalidateAccessibleDoctors(payload.userId);
    this.invalidateUserCacheByPhone(payload.phone);
  }

  async enqueueInboundMessage(data: InboundMessageData): Promise<void> {
    await this.messageProcessor.enqueueInboundMessage(data);
  }

  async processMessage(data: InboundMessageData): Promise<void> {
    return inexciTracer.startActiveSpan('ai.processMessage', async (span) => {
      span.setAttribute('messaging.sid', data.messageSid);
      span.setAttribute('messaging.has_media', !!data.media?.length);
      try {
        const timing: TurnTiming = {
          startedAt: Date.now(),
          timeoutMs: this.configService.get<number>(
            'AI_PROCESS_TIMEOUT_MS',
            90000,
          ),
        };

        const { canonicalPhone: phone, lookupCandidates } =
          this.phoneNormalizer.normalizeInboundPhone(data.from);
        const maskedPhone = this.phoneNormalizer.maskPhone(phone);
        this.logger.log(
          `Processando mensagem de ${maskedPhone} (${(data.body || '').length} chars de texto)`,
        );

        let activeConversationId: string | null = null;

        try {
          this.ensureWithinTimeout(timing.startedAt, timing.timeoutMs);

          const identity = await this.resolveIdentity(
            data,
            phone,
            maskedPhone,
            lookupCandidates,
            timing,
          );
          if (!identity) return;

          const conversation = await this.openConversation(identity);
          activeConversationId = conversation.id;

          const input = await this.ingestInput(data, identity, conversation);
          if (!input) return;

          const modelContext = await this.buildModelContext(
            data,
            identity,
            conversation,
            input,
          );

          const usageSnapshots: CompletionUsageSnapshot[] = [];
          const outcome = await this.runModelLoop(
            data,
            identity,
            conversation,
            modelContext,
            usageSnapshots,
            timing,
          );

          await this.deliverResponse(
            data,
            identity,
            conversation,
            outcome,
            usageSnapshots,
            timing,
          );
        } catch (error) {
          span.recordException(error instanceof Error ? error : String(error));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: errorMessage(error),
          });
          this.logger.error(
            `Erro ao processar mensagem de ${maskedPhone}: ${errorMessage(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
          const { code, name } = (
            typeof error === 'object' && error !== null ? error : {}
          ) as { code?: unknown; name?: unknown };
          const isTimeout =
            code === 'AI_PROCESS_TIMEOUT' ||
            code === 'ETIMEDOUT' ||
            code === 'ECONNABORTED' ||
            name === 'AbortError';

          let userFacingMessage =
            'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou acesse a plataforma web.';
          if (isTimeout) {
            userFacingMessage =
              'A solicitação demorou mais do que o esperado (1 min e 30 s) e foi cancelada. Tente novamente.';
          }

          await this.whatsappService.sendMessage(phone, userFacingMessage);
        } finally {
          if (activeConversationId) {
            try {
              await this.piiBindingService.persistPiiBindings(
                activeConversationId,
              );
            } catch (err) {
              this.logger.debug(
                `[PII_VAULT_PERSIST] finally_failed conv=${activeConversationId} err=${errorMessage(err)}`,
              );
            }
            this.piiVault.endSession(activeConversationId);
          }
        }
      } catch (outerError) {
        span.recordException(
          outerError instanceof Error ? outerError : String(outerError),
        );
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage(outerError),
        });
        throw outerError;
      } finally {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }
    });
  }

  private async resolveIdentity(
    data: InboundMessageData,
    phone: string,
    maskedPhone: string,
    lookupCandidates: string[],
    timing: TurnTiming,
  ): Promise<TurnIdentity | null> {
    const preflight = await this.messageProcessor.runPreflight(
      {
        phone,
        lookupCandidates,
        body: data.body,
        messageSid: data.messageSid,
        processStartedAt: timing.startedAt,
        processTimeoutMs: timing.timeoutMs,
      },
      {
        redactResidualPii: (msgs, ctx) =>
          this.piiBindingService.redactResidualPii(msgs, ctx),
        getRemainingTimeoutMs: (started, total) =>
          this.getRemainingTimeoutMs(started, total),
      },
    );
    if (preflight.status !== 'continue') return null;

    const { user, userId } = preflight;
    const ownerId = user?.ownerId || null;
    setRequestContext({ userId, tenantId: ownerId });

    const cachedDoctorIds = this.doctorIdsCache.get(userId);
    const accessibleDoctorIds =
      cachedDoctorIds ??
      (await this.accessControlService.getAccessibleDoctorIds(userId));
    if (!cachedDoctorIds)
      this.doctorIdsCache.set(userId, accessibleDoctorIds, 5 * 60 * 1000);

    return {
      phone,
      maskedPhone,
      user,
      userId,
      ownerId,
      accessibleDoctorIds,
      isDoctor: Boolean(user.doctorProfile?.id),
      permissions: permissionsOf(user),
    };
  }

  private async openConversation(
    identity: TurnIdentity,
  ): Promise<WhatsappConversation> {
    const conversation = await this.conversationService.getOrCreateConversation(
      identity.phone,
      identity.userId,
      identity.ownerId,
    );

    this.piiVault.startSession(conversation.id);
    const persistedBindings =
      await this.piiBindingService.loadPersistedPiiBindings(conversation.id);
    if (persistedBindings?.length) {
      this.piiVault.restoreSession(conversation.id, persistedBindings);
      this.logger.debug(
        `[PII_VAULT_PERSIST] restored conv=${conversation.id} count=${persistedBindings.length}`,
      );
    }
    return conversation;
  }

  private async ingestInput(
    data: InboundMessageData,
    identity: TurnIdentity,
    conversation: WhatsappConversation,
  ): Promise<TurnInput | null> {
    const { phone, userId, ownerId } = identity;
    const normalizedInput = this.clearContextDetector.normalizeText(data.body);

    const clearOutcome = this.clearContextDetector.tryHandleClearContext(
      phone,
      normalizedInput,
      conversation.id,
    );
    if (clearOutcome.status === 'prompt') {
      await this.whatsappService.sendMessage(phone, clearOutcome.message);
      return null;
    }

    const confirmationOutcome =
      this.clearContextDetector.tryHandleClearContextConfirmation(
        phone,
        normalizedInput,
      );
    if (confirmationOutcome.status === 'confirmed') {
      await this.conversationService.resetConversationHistory(
        confirmationOutcome.conversationId,
      );
      await this.whatsappService.sendMessage(
        phone,
        confirmationOutcome.message,
      );
      return null;
    }
    if (
      confirmationOutcome.status === 'cancelled' ||
      confirmationOutcome.status === 'reprompt'
    ) {
      await this.whatsappService.sendMessage(
        phone,
        confirmationOutcome.message,
      );
      return null;
    }

    const docIntakeResult =
      await this.documentIntakeService.processInboundDocumentIfNeeded({
        phone,
        body: data.body || '',
        normalizedInput,
        messageSid: data.messageSid,
        media: data.media,
        userId,
        ownerId,
        conversationId: conversation.id,
      });
    if (docIntakeResult.handled) return null;
    const effectiveBody = docIntakeResult.syntheticBody ?? data.body;

    const hasInboundAudio =
      this.audioIntakeService.isAudioEnabled() &&
      (data.media || []).some(
        (item) =>
          item.category === 'audio' ||
          this.whatsappMediaService.isAudioMime(item.contentType),
      );

    if (hasInboundAudio) {
      await this.whatsappService.sendMessage(
        phone,
        '🎧 Recebi seu áudio. Estou analisando e já te respondo.',
      );
    }

    const audioProcessing =
      await this.audioIntakeService.processInboundAudioIfNeeded(data);
    const transcriptionContext = audioProcessing.transcription;

    const userInputRaw = this.audioIntakeService.buildUserInputForAi({
      textInput: effectiveBody,
      transcriptionText: transcriptionContext?.text || null,
    });

    const hasTypedText = Boolean((effectiveBody || '').trim());
    if (audioProcessing.failed && !hasTypedText) {
      const failureMessage =
        this.audioIntakeService.buildAudioFailureUserMessage(
          audioProcessing.failureReason,
        );
      await this.whatsappService.sendMessage(phone, failureMessage);
      return null;
    }

    if (!userInputRaw) {
      await this.whatsappService.sendMessage(
        phone,
        'Não consegui identificar texto na sua mensagem. Se preferir, envie novamente em texto ou um áudio mais curto.',
      );
      return null;
    }

    const userInputForAi = this.piiVault.preprocessUserInput(
      conversation.id,
      userInputRaw,
    );

    const userSource = this.audioIntakeService.resolveInboundSource(
      effectiveBody,
      transcriptionContext,
    );

    await this.conversationService.appendMessage(
      conversation.id,
      'user',
      userInputForAi,
      undefined,
      {
        source: userSource,
        transcription: transcriptionContext
          ? {
              text: transcriptionContext.text,
              provider: transcriptionContext.provider,
              language: transcriptionContext.language,
              confidence: transcriptionContext.confidence,
              durationSeconds: transcriptionContext.durationSeconds,
              latencyMs: transcriptionContext.latencyMs,
              fallbackUsed: transcriptionContext.fallbackUsed,
            }
          : undefined,
        inboundMedia: (data.media || []).map((item) => ({
          url: item.url,
          contentType: item.contentType,
          category: item.category,
          durationSeconds: item.durationSeconds,
          sizeBytes:
            transcriptionContext?.downloadedMedia?.url === item.url
              ? transcriptionContext.downloadedMedia.sizeBytes
              : undefined,
        })),
      },
    );

    return { effectiveBody, normalizedInput, userInputForAi };
  }

  private async buildModelContext(
    data: InboundMessageData,
    identity: TurnIdentity,
    conversation: WhatsappConversation,
    input: TurnInput,
  ): Promise<TurnModelContext> {
    const { normalizedInput, userInputForAi, effectiveBody } = input;

    const shouldQueryRag =
      userInputForAi.trim().length >= 15 &&
      !this.clearContextDetector.isConfirmationInput(normalizedInput) &&
      !this.clearContextDetector.isCancelConfirmationInput(normalizedInput) &&
      !/^[0-9]{1,2}$/.test(normalizedInput) &&
      !this.clearContextDetector.isClearContextCommand(normalizedInput);

    if (!shouldQueryRag) {
      this.logger.debug(
        `[RAG] sid=${data.messageSid} skipped=true reason=trivial_input`,
      );
    }

    const ragResults = shouldQueryRag
      ? ((await this.ragService.search(userInputForAi)) ?? [])
      : [];
    const ragMetrics = shouldQueryRag
      ? this.ragService.computeMetrics(ragResults)
      : null;
    const ragContext = shouldQueryRag
      ? await this.ragService.formatContext(ragResults)
      : null;

    const refreshedConversation =
      (await this.conversationService.findById(conversation.id)) ??
      conversation;

    const accessibleDoctorsInfo =
      await this.conversationMemory.resolveDoctorsInfo(
        identity.accessibleDoctorIds,
      );

    const built = await this.contextService.buildContext({
      conversation: refreshedConversation,
      ragContext: ragContext || null,
      userInfo: {
        id: identity.userId,
        name: identity.user?.name ?? null,
        role: identity.user?.role ?? null,
        isDoctor: identity.isDoctor,
        ownerId: identity.ownerId,
        accessibleDoctors: accessibleDoctorsInfo,
      },
    });
    const messages: OpenAI.ChatCompletionMessageParam[] = built.messages;

    const numericHint = await this.confirmationManager.buildNumericChoiceHint(
      conversation.id,
      effectiveBody || '',
    );
    if (numericHint)
      this.injectSystemHint(
        messages,
        numericHint,
        'NUMERIC_CHOICE',
        data.messageSid,
        conversation.id,
      );

    const confirmationHint =
      await this.confirmationManager.buildPendingConfirmationHint(
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

    const documentHint =
      await this.documentIntakeService.buildDocumentPendingHint(identity.phone);
    if (documentHint)
      this.injectSystemHint(
        messages,
        documentHint,
        'AI_DOC_PENDING_HINT',
        data.messageSid,
        conversation.id,
        'user',
      );

    const draftCtx = await this.draftContext.buildToolsForDraft(
      conversation.id,
    );

    return {
      messages,
      tools: draftCtx.tools,
      activeDraftType: draftCtx.draftType,
      breakdown: built.breakdown,
      strategy: built.strategy,
      ragMetrics,
    };
  }

  private async runModelLoop(
    data: InboundMessageData,
    identity: TurnIdentity,
    conversation: WhatsappConversation,
    modelContext: TurnModelContext,
    usageSnapshots: CompletionUsageSnapshot[],
    timing: TurnTiming,
  ): Promise<TurnLoopOutcome> {
    const { messages, tools, activeDraftType } = modelContext;

    this.ensureWithinTimeout(timing.startedAt, timing.timeoutMs);
    await this.piiBindingService.redactResidualPii(messages, {
      conversationId: conversation.id,
      messageSid: data.messageSid,
    });
    const t0Initial = Date.now();
    const promptCacheKey = this.draftContext.buildCacheKey(activeDraftType);
    const completion = await this.openaiService.chatCompletion({
      messages,
      tools,
      temperature: 0.2,
      maxTokens: this.getResponseMaxTokens(),
      timeoutMs: this.getRemainingTimeoutMs(timing.startedAt, timing.timeoutMs),
      cacheKey: promptCacheKey,
    });
    this.telemetry.captureUsageSnapshot(
      usageSnapshots,
      'initial',
      completion,
      Date.now() - t0Initial,
      {
        breakdown: modelContext.breakdown,
        strategy: modelContext.strategy,
        toolsCount: tools.length,
        draftType: activeDraftType,
        cacheKey: promptCacheKey,
        rag: modelContext.ragMetrics ?? undefined,
      },
    );
    const initialResponseMessage = completion.choices[0].message;
    const hadTools = Boolean(initialResponseMessage.tool_calls?.length);

    const toolContext: ToolContext = {
      userId: identity.userId,
      phone: identity.phone,
      accessibleDoctorIds: identity.accessibleDoctorIds,
      ownerId: identity.ownerId,
      permissions: identity.permissions,
      conversationId: conversation.id,
      inboundMedia: data.media || [],
      piiVault: this.piiVault,
    };

    const loopResult = await this.toolLoopRunner.run({
      messages,
      initialResponseMessage,
      toolContext,
      conversationId: conversation.id,
      messageSid: data.messageSid,
      usageSnapshots,
      initialActiveDraftType: activeDraftType,
      initialPromptCacheKey: promptCacheKey,
      processStartedAt: timing.startedAt,
      processTimeoutMs: timing.timeoutMs,
      hooks: {
        memorizeEntitiesFromToolCall: (memoInput) =>
          this.conversationMemory.memorizeEntities(memoInput),
        appendNextStepIfNeeded: (functionName, args, output, ctx) =>
          this.nextStepAdvisor.appendNextStep(functionName, args, output, ctx),
        redactResidualPii: (msgs, ctx) =>
          this.piiBindingService.redactResidualPii(msgs, ctx),
        buildToolsForCurrentDraft: (conversationId) =>
          this.draftContext.buildToolsForDraft(conversationId),
        buildPromptCacheKey: (draftType) =>
          this.draftContext.buildCacheKey(draftType),
        getResponseMaxTokens: () => this.getResponseMaxTokens(),
        getRemainingTimeoutMs: (started, total) =>
          this.getRemainingTimeoutMs(started, total),
      },
    });

    return {
      responseMessage: loopResult.responseMessage,
      activeDraftType: loopResult.activeDraftType,
      loopLimitReached: loopResult.loopLimitReached,
      pendingToolNames: loopResult.pendingToolNames,
      hadTools,
    };
  }

  private async deliverResponse(
    data: InboundMessageData,
    identity: TurnIdentity,
    conversation: WhatsappConversation,
    outcome: TurnLoopOutcome,
    usageSnapshots: CompletionUsageSnapshot[],
    timing: TurnTiming,
  ): Promise<void> {
    const { phone, userId, ownerId, maskedPhone } = identity;

    const trimmedContent = outcome.responseMessage.content?.trim() ?? '';
    let finalText: string;
    if (outcome.loopLimitReached && !trimmedContent) {
      finalText = this.buildLoopLimitFallback(
        outcome.pendingToolNames,
        outcome.activeDraftType,
      );
    } else {
      finalText =
        trimmedContent ||
        'Posso te ajudar com algo específico? Me diga em poucas palavras o que precisa que eu sigo daí.';
    }

    finalText = this.responseNormalizer.normalizeWhatsappText(finalText);

    if (finalText.length > MAX_RESPONSE_LENGTH) {
      finalText =
        finalText.slice(0, MAX_RESPONSE_LENGTH - 60) +
        '...\n\n_Acesse a plataforma para ver a resposta completa._';
    }

    const sanitizedHistoryText = this.sanitizeAssistantOutputForHistory(
      finalText,
      conversation.id,
      data.messageSid,
    );

    await this.conversationService.appendMessage(
      conversation.id,
      'assistant',
      sanitizedHistoryText,
    );

    const detokenizedText = this.piiVault.detokenize(
      conversation.id,
      finalText,
    );
    const scrubbedText = this.responseNormalizer.scrubResidualPlaceholders(
      detokenizedText,
      conversation.id,
      data.messageSid,
    );
    const safeText = this.responseNormalizer.collapseSCPrefixes(
      scrubbedText,
      conversation.id,
      data.messageSid,
    );

    await this.whatsappService.sendMessage(phone, safeText);
    await this.trySendInteractiveConfirmationTemplate(phone, safeText);

    await this.telemetry.persistUsageSummary(
      phone,
      data.messageSid,
      conversation.id,
      userId,
      ownerId,
      usageSnapshots,
    );

    this.telemetry.logUsageSummary(phone, data.messageSid, usageSnapshots);

    this.refreshSummaryInBackground(conversation);

    this.telemetry.logPiiVaultUsage(data.messageSid, conversation.id);

    this.logger.log(
      `Resposta enviada para ${maskedPhone} (${safeText.length} chars)`,
    );

    recordAiProcessingDuration(Date.now() - timing.startedAt, {
      channel: 'whatsapp',
      intent: outcome.activeDraftType ?? 'none',
      hadTools: outcome.hadTools,
    });
  }

  private refreshSummaryInBackground(conversation: WhatsappConversation): void {
    const convId = conversation.id;
    Promise.resolve()
      .then(async () => {
        const conv =
          (await this.conversationService.findById(convId)) ?? conversation;
        if (await this.contextService.shouldRefreshSummary(conv)) {
          await this.contextService.updateSummaryAndMemory(convId);
        }
      })
      .catch((err) => {
        this.logger.warn(
          `[CONTEXT_SUMMARY] background_failed conv=${convId} err=${errorMessage(err)}`,
        );
      });
  }

  private getRemainingTimeoutMs(
    startedAt: number,
    totalTimeoutMs: number,
  ): number {
    const elapsed = Date.now() - startedAt;
    const remaining = totalTimeoutMs - elapsed;
    if (remaining <= 0) {
      const err: Error & { code?: string } = new Error(
        `AI processing timeout after ${totalTimeoutMs}ms`,
      );
      err.code = 'AI_PROCESS_TIMEOUT';
      throw err;
    }
    return remaining;
  }

  private ensureWithinTimeout(startedAt: number, totalTimeoutMs: number): void {
    this.getRemainingTimeoutMs(startedAt, totalTimeoutMs);
  }

  private async trySendInteractiveConfirmationTemplate(
    phone: string,
    finalText: string,
  ): Promise<boolean> {
    if (!this.responseNormalizer.isConfirmationPrompt(finalText)) return false;

    const contentSid = WHATSAPP_TEMPLATES.AI_ACTION_CONFIRMATION;

    if (!contentSid) return false;

    try {
      await this.whatsappService.sendTemplate(phone, contentSid, {
        '1': finalText,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Falha ao enfileirar template interativo de confirmação para ${this.phoneNormalizer.maskPhone(phone)}: ${errorMessage(error) || 'erro desconhecido'}`,
      );
      return false;
    }
  }

  private injectSystemHint(
    messages: OpenAI.ChatCompletionMessageParam[],
    hint: string,
    tag: string,
    messageSid: string,
    convId: string,
    role: 'system' | 'user' = 'system',
  ): void {
    const insertAt = messages.findIndex((m) => m.role !== 'system');
    messages.splice(insertAt === -1 ? messages.length : insertAt, 0, {
      role,
      content: hint,
    });
    this.logger.log(`[${tag}] sid=${messageSid} conv=${convId} injected=true`);
  }
}
