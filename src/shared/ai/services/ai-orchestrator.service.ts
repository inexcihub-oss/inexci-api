import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from './openai.service';
import { PiiVaultService } from './pii-vault.service';
import { PiiBindingService } from './orchestrator/pii-binding.service';
import { ConversationService } from './conversation.service';
import { ConversationContextService } from './conversation-context.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { OrchestratorTelemetryService } from './orchestrator/orchestrator-telemetry.service';
import { ToolLoopRunnerService } from './orchestrator/tool-loop-runner.service';
import { MessageProcessorService } from './orchestrator/message-processor.service';
import { SessionBootstrapService } from './orchestrator/session-bootstrap.service';
import { InputPipelineService } from './orchestrator/input-pipeline.service';
import { ContextPipelineService } from './orchestrator/context-pipeline.service';
import { ResponseDispatchService } from './orchestrator/response-dispatch.service';
import { ModelGatewayService } from './model-gateway.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CompletionUsageSnapshot } from './orchestrator/orchestrator-telemetry.service';
import { inexciTracer, SpanStatusCode } from '../../observability/tracer';

/**
 * Coordenador do pipeline de IA do WhatsApp.
 *
 * Responsabilidade: orquestrar a sequência de etapas sem implementar
 * nenhuma delas diretamente. Cada etapa vive em seu próprio serviço:
 *
 * - `SessionBootstrapService`  → sessão, PII vault, doctorIds
 * - `InputPipelineService`     → clear-context, doc/audio intake, PII tokenize
 * - `ContextPipelineService`   → runtime state, planner, RAG, hints, tools
 * - `ToolLoopRunnerService`    → loop de tool calls (≤ 8 iterações)
 * - `ResponseDispatchService`  → texto final, histórico, detokenize, WhatsApp
 * - `OrchestratorTelemetryService` → tokens, custo, latência
 */
@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly openaiService: OpenaiService,
    private readonly piiVault: PiiVaultService,
    private readonly piiBindingService: PiiBindingService,
    private readonly conversationService: ConversationService,
    private readonly contextService: ConversationContextService,
    private readonly phoneNormalizer: PhoneNormalizerService,
    private readonly telemetry: OrchestratorTelemetryService,
    private readonly toolLoopRunner: ToolLoopRunnerService,
    private readonly messageProcessor: MessageProcessorService,
    private readonly sessionBootstrap: SessionBootstrapService,
    private readonly inputPipeline: InputPipelineService,
    private readonly contextPipeline: ContextPipelineService,
    private readonly responseDispatch: ResponseDispatchService,
    private readonly whatsappService: WhatsappService,
    @Optional() private readonly modelGateway?: ModelGatewayService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  invalidateUserCacheByPhone(phone: string | null | undefined): void {
    this.messageProcessor.invalidateUserCacheByPhone(phone);
  }

  async enqueueInboundMessage(data: {
    from: string;
    body: string;
    messageSid: string;
    mediaUrl: string | null;
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'image' | 'pdf' | 'other';
      durationSeconds: number | null;
    }>;
  }): Promise<void> {
    await this.messageProcessor.enqueueInboundMessage(data);
  }

  async processMessage(data: {
    from: string;
    body: string;
    messageSid: string;
    mediaUrl: string | null;
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'image' | 'pdf' | 'other';
      durationSeconds: number | null;
    }>;
  }): Promise<void> {
    return inexciTracer.startActiveSpan('ai.processMessage', async (span) => {
      span.setAttribute('messaging.sid', data.messageSid);
      span.setAttribute('messaging.has_media', !!data.media?.length);

      let activeConversationId: string | null = null;

      try {
        const processTimeoutMs = this.configService.get<number>(
          'AI_PROCESS_TIMEOUT_MS',
          90000,
        );
        const processStartedAt = Date.now();

        const { canonicalPhone, lookupCandidates } =
          this.phoneNormalizer.normalizeInboundPhone(data.from);
        const phone = canonicalPhone;
        const maskedPhone = this.phoneNormalizer.maskPhone(phone);
        this.logger.log(
          `Processando mensagem de ${maskedPhone} (${(data.body || '').length} chars de texto)`,
        );

        // 1. Preflight: user lookup, consentimentos, FAQ limitado
        const preflight = await this.messageProcessor.runPreflight(
          {
            phone,
            lookupCandidates,
            body: data.body,
            messageSid: data.messageSid,
            processStartedAt,
            processTimeoutMs,
          },
          {
            redactResidualPii: (msgs, ctx) =>
              this.piiBindingService.redactResidualPii(msgs, ctx),
            getRemainingTimeoutMs: (started, total) =>
              this.getRemainingTimeoutMs(started, total),
          },
        );
        if (preflight.status !== 'continue') return;
        const { user, userId } = preflight;

        // 2. Session bootstrap: conversa, doctorIds, PII vault
        const session = await this.sessionBootstrap.setup(phone, userId, user);
        activeConversationId = session.conversation.id;
        this.ensureWithinTimeout(processStartedAt, processTimeoutMs);

        // 3. Input pipeline: clear-context, doc/audio, PII tokenize, append msg
        const inputOutcome = await this.inputPipeline.process(
          data,
          phone,
          session.conversation,
          userId,
          session.ownerId,
        );
        if (inputOutcome.handled) return;

        // 4. Context pipeline: runtime state, planner, RAG, hints, tools
        const ctx = await this.contextPipeline.prepare({
          data,
          phone,
          conversation: session.conversation,
          accessibleDoctorIds: session.accessibleDoctorIds,
          userId,
          ownerId: session.ownerId,
          user,
          input: inputOutcome,
          piiVaultRef: this.piiVault,
        });

        this.ensureWithinTimeout(processStartedAt, processTimeoutMs);

        // 5. Redação defensiva antes da primeira chamada à OpenAI
        await this.piiBindingService.redactResidualPii(ctx.messages, {
          conversationId: session.conversation.id,
          messageSid: data.messageSid,
        });

        // 6. Chamada inicial ao LLM
        const usageSnapshots: CompletionUsageSnapshot[] = [];
        const t0Initial = Date.now();
        const completion =
          this.modelGateway && this.isFeatureEnabled('AI_MODEL_GATEWAY_ENABLED')
            ? await this.modelGateway.chatCompletion({
                tier: 'standard',
                operation: ctx.telemetryMeta.operation,
                messages: ctx.messages,
                tools: ctx.tools,
                temperature: 0.2,
                maxTokens: this.getResponseMaxTokens(),
                timeoutMs: this.getRemainingTimeoutMs(processStartedAt, processTimeoutMs),
                cacheKey: ctx.promptCacheKey,
              })
            : await this.openaiService.chatCompletion({
                messages: ctx.messages,
                tools: ctx.tools,
                temperature: 0.2,
                maxTokens: this.getResponseMaxTokens(),
                timeoutMs: this.getRemainingTimeoutMs(processStartedAt, processTimeoutMs),
                cacheKey: ctx.promptCacheKey,
              });

        this.telemetry.captureUsageSnapshot(
          usageSnapshots,
          'initial',
          completion,
          Date.now() - t0Initial,
          {
            ...ctx.telemetryMeta,
            tier: this.modelGateway ? 'standard' : 'legacy',
            rag: ctx.telemetryMeta.rag ?? undefined,
          },
        );

        // 7. Tool loop (≤ 8 iterações)
        const loopResult = await this.toolLoopRunner.run({
          messages: ctx.messages,
          initialResponseMessage: completion.choices[0].message,
          toolContext: ctx.toolContext,
          conversationId: session.conversation.id,
          messageSid: data.messageSid,
          usageSnapshots,
          initialActiveDraftType: ctx.activeDraftType,
          initialPromptCacheKey: ctx.promptCacheKey,
          processStartedAt,
          processTimeoutMs,
          hooks: this.contextPipeline.buildLoopHooks({
            conversationId: session.conversation.id,
            messageSid: data.messageSid,
            getResponseMaxTokens: () => this.getResponseMaxTokens(),
            getRemainingTimeoutMs: (started, total) =>
              this.getRemainingTimeoutMs(started, total),
          }),
        });

        // 8. Dispatch: texto final, histórico, detokenize, envio WhatsApp
        await this.responseDispatch.dispatch({
          phone,
          conversationId: session.conversation.id,
          messageSid: data.messageSid,
          loopResult,
        });

        // 9. Telemetria
        await this.telemetry.persistUsageSummary(
          phone,
          data.messageSid,
          session.conversation.id,
          userId,
          session.ownerId,
          usageSnapshots,
        );
        this.telemetry.logUsageSummary(phone, data.messageSid, usageSnapshots);
        this.telemetry.logPiiVaultUsage(data.messageSid, session.conversation.id);

        // 10. Summary/memory em background (não bloqueia resposta)
        this.triggerBackgroundSummary(
          phone,
          userId,
          session.ownerId,
          session.conversation.id,
        );
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
        this.logger.error(
          `Erro ao processar mensagem: ${error.message}`,
          error.stack,
        );

        const isTimeout =
          error?.code === 'AI_PROCESS_TIMEOUT' ||
          error?.code === 'ETIMEDOUT' ||
          error?.code === 'ECONNABORTED' ||
          error?.name === 'AbortError';

        const userFacingMessage = isTimeout
          ? 'A solicitação demorou mais do que o esperado (1 min e 30 s) e foi cancelada. Tente novamente.'
          : 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou acesse a plataforma web.';

        const { canonicalPhone } = this.phoneNormalizer.normalizeInboundPhone(
          data.from,
        );
        try {
          await this.whatsappService.sendMessage(canonicalPhone, userFacingMessage);
        } catch {
          // melhor-esforço no path de erro
        }
      } finally {
        if (activeConversationId) {
          try {
            await this.piiBindingService.persistPiiBindings(activeConversationId);
          } catch (err: any) {
            this.logger.debug(
              `[PII_VAULT_PERSIST] finally_failed conv=${activeConversationId} err=${err?.message || err}`,
            );
          }
          this.piiVault.endSession(activeConversationId);
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getResponseMaxTokens(): number {
    const value = this.configService.get<number>('AI_RESPONSE_MAX_TOKENS', 450);
    return Math.max(60, Math.floor(Number(value) || 450));
  }

  private isFeatureEnabled(key: string, defaultValue = true): boolean {
    const raw = String(
      this.configService.get<string>(key, defaultValue ? 'true' : 'false'),
    )
      .trim()
      .toLowerCase();
    return raw === 'true' || raw === '1';
  }

  private getRemainingTimeoutMs(startedAt: number, totalTimeoutMs: number): number {
    const elapsed = Date.now() - startedAt;
    const remaining = totalTimeoutMs - elapsed;
    if (remaining <= 0) {
      const err: any = new Error(`AI processing timeout after ${totalTimeoutMs}ms`);
      err.code = 'AI_PROCESS_TIMEOUT';
      throw err;
    }
    return remaining;
  }

  private ensureWithinTimeout(startedAt: number, totalTimeoutMs: number): void {
    this.getRemainingTimeoutMs(startedAt, totalTimeoutMs);
  }

  private triggerBackgroundSummary(
    phone: string,
    userId: string,
    ownerId: string | null,
    convId: string,
  ): void {
    const ctxService = this.contextService;
    const convService = this.conversationService;
    Promise.resolve()
      .then(async () => {
        const conv = await convService.getOrCreateConversation(phone, userId, ownerId);
        if (await ctxService.shouldRefreshSummary(conv)) {
          await ctxService.updateSummaryAndMemory(convId);
        }
      })
      .catch((err) => {
        this.logger.warn(
          `[CONTEXT_SUMMARY] background_failed conv=${convId} err=${err?.message || err}`,
        );
      });
  }

}
