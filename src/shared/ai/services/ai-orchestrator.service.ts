import { Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { ConversationService } from './conversation.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { ConversationContextService } from './conversation-context.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { PiiVaultService } from './pii-vault.service';
import { AiRedisService } from './ai-redis.service';
import { RagService } from '../../rag/rag.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { UserRepository } from '../../../database/repositories/user.repository';
import { AccessControlService } from '../../services/access-control.service';
import { ToolContext } from '../tools/tool.interface';
import { PROMPT_VERSION } from '../prompts/system-prompt';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { AiPiiRedactionLogRepository } from '../../../database/repositories/ai-pii-redaction-log.repository';
import { WhatsappMediaService } from '../../whatsapp/whatsapp-media.service';
import { WHATSAPP_TEMPLATES } from '../../whatsapp/whatsapp-templates.constants';
import { DocumentIntakeService } from './orchestrator/document-intake.service';
import { AudioIntakeService } from './orchestrator/audio-intake.service';
import { PiiBindingService } from './orchestrator/pii-binding.service';
import { collapseDuplicatedScPrefixes } from '../tools/protocol.helpers';
import { parseToolResult } from '../tools/tool-result';
import { OperationDraftService } from './operation-draft.service';
import { OperationDraftType } from '../drafts/operation-draft.types';
import {
  MAX_RESPONSE_LENGTH,
  ResponseNormalizerService,
} from './orchestrator/response-normalizer.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';
import { ClearContextDetectorService } from './orchestrator/clear-context-detector.service';
import { ConfirmationManagerService } from './orchestrator/confirmation-manager.service';
import {
  CompletionUsageSnapshot,
  OrchestratorTelemetryService,
} from './orchestrator/orchestrator-telemetry.service';
import { ToolLoopRunnerService } from './orchestrator/tool-loop-runner.service';
import { MessageProcessorService } from './orchestrator/message-processor.service';
import { inexciTracer, SpanStatusCode } from '../../observability/tracer';

const MUTATION_TOOL_NAMES = new Set<string>([
  'advance_surgery_request',
  'set_has_opme',
  'close_surgery_request',
  'reschedule_surgery',
  'confirm_receipt',
  'update_receipt',
  'manage_report_sections',
  'set_hospital',
  'add_tuss_item',
  'add_opme_item',
  'attach_document_from_whatsapp',
  'create_patient_from_document',
]);

/**
 * Tools de mutação que iniciam um fluxo COMPLEXO (múltiplos campos) e
 * portanto exigem `plan_actions` antes — quando `AI_USE_DRAFT_FLOWS=true`.
 * Tools de draft (`*_draft_*`) e tools de mutação simples (avanço/encerramento,
 * confirmar data, set flags) ficam fora — não precisam de pre-planning.
 */
// Sub-fase 3.9 (2026-05-12): todas as tools legacy de mutação complexa foram
// removidas (3.1–3.8). O set é mantido como infraestrutura para uso futuro;
// enquanto estiver vazio, `evaluatePlanFirstGuard` é um no-op.
const COMPLEX_MUTATION_TOOL_NAMES = new Set<string>([]);

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SimpleCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Coordenador do pipeline de IA do WhatsApp; delega aos colaboradores da
 * Fase 1 (`MessageProcessor`, `ToolLoopRunner`, `ConfirmationManager`,
 * `OrchestratorTelemetry`, `ResponseNormalizer`, `PhoneNormalizer`,
 * `ClearContextDetector`). Fase 4 do `PLANO-SANITIZACAO-CLEAN-CODE-IA`
 * removeu as heurísticas legadas de `pending_confirmation`
 * (`PREVIEWABLE_MUTATION_TOOLS`, `looksLikeConfirmationPreview`,
 * `looksLikeExecutedMutation`): toda decisão agora vem do envelope
 * canônico `ToolResult` via `parseToolResult` — inclusive em
 * `memorizeEntitiesFromToolCall`, que só grava quando `status === 'ok'`.
 */
@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);
  private readonly doctorIdsCache = new SimpleCache<string[]>();
  private readonly accessibleDoctorsInfoCache = new SimpleCache<
    Array<{ id: string; name?: string | null }>
  >();

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly conversationService: ConversationService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly ragService: RagService,
    private readonly whatsappService: WhatsappService,
    private readonly userRepository: UserRepository,
    private readonly accessControlService: AccessControlService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly surgeryRequestRepo: SurgeryRequestRepository,
    private readonly configService: ConfigService,
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly piiVault: PiiVaultService,
    private readonly piiRedactionLogRepo: AiPiiRedactionLogRepository,
    private readonly aiRedis: AiRedisService,
    private readonly contextService: ConversationContextService,
    private readonly whatsappConversationRepo: WhatsappConversationRepository,
    private readonly operationDraftService: OperationDraftService,
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
  ) {}

  private getResponseMaxTokens(): number {
    const value = this.configService.get<number>('AI_RESPONSE_MAX_TOKENS', 450);
    return Math.max(60, Math.floor(Number(value) || 450));
  }

  /**
   * Constrói o array de tools a ser enviado ao LLM filtrando-o pelo
   * `operation_draft` ativo. Mantemos sempre as tools "globais" (que não
   * são de draft) e expomos as `*_draft_*` apenas quando há um draft do
   * tipo correspondente. Sem esse filtro, a lista total (~138 tools)
   * estoura o limite de 128 tools por request da OpenAI.
   */
  private async buildToolsForCurrentDraft(conversationId: string): Promise<{
    tools: OpenAI.ChatCompletionTool[];
    draftType: OperationDraftType | null;
  }> {
    let activeDraftType: OperationDraftType | null = null;
    try {
      const current =
        await this.operationDraftService.getCurrent(conversationId);
      activeDraftType = current?.type ?? null;
    } catch (err) {
      this.logger.warn(
        `[TOOLS_FILTER] falha ao consultar draft conv=${conversationId}: ${String(
          (err as Error)?.message ?? err,
        )}`,
      );
    }
    return {
      tools: this.toolRegistry.getToolDefinitionsForDraft(activeDraftType),
      draftType: activeDraftType,
    };
  }

  /**
   * Chave de roteamento de prompt caching da OpenAI. Mantém requests com o
   * mesmo prefixo (system + tools) na mesma réplica, maximizando o hit rate.
   * Inclui `PROMPT_VERSION` para invalidar automaticamente o cache sempre
   * que o prompt mudar (basta bumpar a constante em `prompts/system-prompt.ts`)
   * e `draft=...` para evitar misturar requests com lista de tools diferente.
   * Fase 1 do `PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA.md`.
   */
  private buildPromptCacheKey(
    activeDraftType: OperationDraftType | null,
  ): string {
    return `inexci:wa:v${PROMPT_VERSION}:draft=${activeDraftType ?? 'none'}`;
  }

  /**
   * Lê do banco a memória mais recente da conversa (cobre escritas feitas
   * em turnos anteriores que ainda não estão no objeto carregado na
   * variável local).
   */
  private async readConversationMemory(
    conversationId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const conv = await this.whatsappConversationRepo.findOne({
        id: conversationId,
      } as any);
      return (conv?.conversationMemory as Record<string, unknown>) || null;
    } catch (err) {
      this.logger.debug(
        `[PENDING_CONFIRMATION] read_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
      return null;
    }
  }

  private async writeConversationMemoryPatch(
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    try {
      const conv = await this.whatsappConversationRepo.findOne({
        id: conversationId,
      } as any);
      if (!conv) return;
      const memory = (conv.conversationMemory as Record<string, unknown>) || {};
      await this.whatsappConversationRepo.update(conversationId, {
        conversationMemory: { ...memory, ...patch } as any,
      });
    } catch (err) {
      this.logger.debug(
        `[PENDING_CONFIRMATION] write_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Memoriza entidades em `conversationMemory.filled_slots` /
   * `surgeryRequest` para o system prompt do próximo turno injetar no
   * bloco "SC EM CONSTRUÇÃO" e o LLM não voltar a perguntar a mesma
   * coisa. Fase 4 do `PLANO-SANITIZACAO-CLEAN-CODE-IA`: o gate é o
   * envelope canônico (`status !== 'ok'` não memoriza); leituras sem
   * envelope (ex.: `query_patients`) caem no switch abaixo.
   */
  private async memorizeEntitiesFromToolCall(opts: {
    conversationId: string;
    toolName: string;
    args: Record<string, any>;
    output: string;
  }): Promise<void> {
    const { conversationId, toolName, args, output } = opts;

    const parsed = parseToolResult(output);
    if (parsed && parsed.status !== 'ok') return;

    const memory = (await this.readConversationMemory(conversationId)) || {};
    const filled: Record<string, unknown> = {
      ...((memory as any).filled_slots || {}),
    };
    const surgeryRequest: Record<string, unknown> = {
      ...((memory as any).surgeryRequest || {}),
    };

    const setIfPresent = (
      target: Record<string, unknown>,
      key: string,
      value: unknown,
    ) => {
      if (value === null || value === undefined) return;
      const text = String(value).trim();
      if (!text) return;
      target[key] = text;
    };

    switch (toolName) {
      case 'set_hospital':
        setIfPresent(
          surgeryRequest,
          'hospital',
          args.hospitalId || args.hospital_name,
        );
        break;
      case 'set_health_plan':
        setIfPresent(
          surgeryRequest,
          'healthPlan',
          args.healthPlanId || args.health_plan_name,
        );
        break;
      default:
        return;
    }

    await this.writeConversationMemoryPatch(conversationId, {
      filled_slots: filled,
      surgeryRequest,
    });
  }

  /**
   * Resolve a lista de médicos acessíveis ao usuário em `{id, name}` —
   * usado para enriquecer o bloco "USUÁRIO ATUAL" no contexto da IA. Cache
   * curto (5 min) para evitar consulta a cada mensagem.
   */
  private async resolveAccessibleDoctorsInfo(
    accessibleDoctorIds: string[],
  ): Promise<Array<{ id: string; name?: string | null }>> {
    if (!accessibleDoctorIds.length) return [];
    const cacheKey = accessibleDoctorIds.slice().sort().join(',');
    const cached = this.accessibleDoctorsInfoCache.get(cacheKey);
    if (cached) return cached;
    try {
      const doctors = await this.userRepository.findMany(
        { id: In(accessibleDoctorIds) } as any,
        0,
        accessibleDoctorIds.length,
      );
      const info = doctors.map((d: any) => ({
        id: d.id,
        name: d.name ?? null,
      }));
      this.accessibleDoctorsInfoCache.set(cacheKey, info, 5 * 60 * 1000);
      return info;
    } catch (err) {
      this.logger.debug(
        `[USER_CONTEXT] failed_to_resolve_doctors err=${(err as Error)?.message}`,
      );
      return accessibleDoctorIds.map((id) => ({ id, name: null }));
    }
  }

  /**
   * Identifica tool_calls de mutação COMPLEXA que devem ser bloqueadas
   * porque não há `plan_actions` no mesmo turno nem `operation_draft` ativo.
   * Aplica-se somente quando `AI_USE_DRAFT_FLOWS=true`.
   */
  private async evaluatePlanFirstGuard(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined,
    conversationId: string,
  ): Promise<Set<string>> {
    const blocked = new Set<string>();
    if (!toolCalls?.length) return blocked;

    const flagValue = String(
      this.configService.get<string>('AI_USE_DRAFT_FLOWS', 'true'),
    ).toLowerCase();
    if (flagValue !== 'true' && flagValue !== '1') return blocked;

    // Se o LLM já chamou plan_actions neste mesmo turno, libera todos.
    const calledPlanActions = toolCalls.some(
      (call) => call.function?.name === 'plan_actions',
    );
    if (calledPlanActions) return blocked;

    // Se já existe operation_draft ativo, o plan_actions desta sessão
    // já foi chamado em turno anterior — não exigimos novamente.
    let draftActive = false;
    try {
      const current =
        await this.operationDraftService.getCurrent(conversationId);
      draftActive = !!current;
    } catch (err) {
      this.logger.warn(
        `[PLAN_GUARD] falha ao consultar operation_draft conv=${conversationId}: ${String((err as Error)?.message ?? err)}`,
      );
    }
    if (draftActive) return blocked;

    for (const call of toolCalls) {
      const name = call.function?.name;
      if (name && COMPLEX_MUTATION_TOOL_NAMES.has(name)) {
        blocked.add(call.id);
      }
    }
    return blocked;
  }

  /**
   * Mascara CPF/telefone/email "literais" produzidos pelo próprio assistente
   * antes de persistir a mensagem no histórico conversacional.
   *
   * Motivo: o LLM costuma escrever exemplos de formato em respostas
   * orientativas (ex.: "Telefone (formato: DDD + número, ex: 31 99999-9999)").
   * Sanitizar aqui mantém o histórico limpo de PII estrutural; mesmo que
   * algo escape, o `redactResidualPii` redige in-place antes da chamada à
   * OpenAI no turno seguinte (sem incomodar o usuário).
   *
   * Placeholders válidos do vault (`{{categoria_n}}`) são preservados pois as
   * regexes de CPF/telefone/email não casam com chaves duplas.
   */
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
    // Colapsa prefixos `SC-` duplicados que a IA possa ter inserido por
    // engano antes de `{{protocol_n}}` (ex.: "SC-SC-{{protocol_1}}").
    // Aplicado no histórico para impedir que o erro se replique nos próximos
    // turnos via contexto.
    return this.collapseDuplicatedScInText(
      result.text,
      conversationId,
      messageSid,
    );
  }

  /**
   * Sanitização final aplicada ao texto JÁ detokenizado, antes do envio ao
   * WhatsApp e da gravação no histórico. Colapsa quaisquer ocorrências de
   * `SC-SC-XXX` (e variações com 3+ prefixos) em um único `SC-XXX`. Quando
   * detecta a duplicação, loga um aviso para diagnóstico.
   */
  private collapseDuplicatedScInText(
    text: string,
    conversationId: string,
    messageSid: string,
  ): string {
    if (!text) return text;
    const collapsed = collapseDuplicatedScPrefixes(text);
    if (collapsed !== text) {
      this.logger.warn(
        `[AI_PROTOCOL_DUP_PREFIX] sid=${messageSid} conv=${conversationId} colapso=SC-SC->SC-`,
      );
    }
    return collapsed;
  }

  /**
   * Invalida o cache do usuário e o cooldown da mensagem de consentimento.
   * Usado pelo `ConsentService` quando o usuário concede/revoga consentimento
   * via web — assim a próxima mensagem do WhatsApp já reflete o novo estado.
   *
   * Sem invocação explícita, o cache TTL (10 min) garante que a próxima sessão
   * eventualmente recarregue o usuário do banco. Aceitável como fallback.
   */
  invalidateUserCacheByPhone(phone: string | null | undefined): void {
    this.messageProcessor.invalidateUserCacheByPhone(phone);
  }

  /**
   * Métrica de uso do vault por sessão (T0.11). Emite um único log estruturado
   * que pode ser raspado por agregadores (Datadog/CloudWatch) ou substituído
   * por contador Prometheus em iteração futura.
   */
  private logPiiVaultUsage(messageSid: string, conversationId: string): void {
    try {
      const counts = this.piiVault.categoryCounts(conversationId);
      const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
      if (!nonZero.length) return;
      const breakdown = nonZero.map(([cat, n]) => `${cat}=${n}`).join(',');
      const total = nonZero.reduce((acc, [, n]) => acc + n, 0);
      this.logger.log(
        `[AI_PII_USAGE] sid=${messageSid} total=${total} ${breakdown}`,
      );
    } catch (err: any) {
      this.logger.debug(
        `Falha ao calcular métrica de PII: ${err?.message || 'erro desconhecido'}`,
      );
    }
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

        let activeConversationId: string | null = null;

        try {
          this.ensureWithinTimeout(processStartedAt, processTimeoutMs);

          const usageSnapshots: CompletionUsageSnapshot[] = [];

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

          const cachedDoctorIds = this.doctorIdsCache.get(userId);
          const accessibleDoctorIds =
            cachedDoctorIds ??
            (await this.accessControlService.getAccessibleDoctorIds(userId));
          if (!cachedDoctorIds)
            this.doctorIdsCache.set(userId, accessibleDoctorIds, 5 * 60 * 1000); // 5 min

          const ownerId = user?.ownerId || null;
          const conversation =
            await this.conversationService.getOrCreateConversation(
              phone,
              userId,
              ownerId,
            );
          activeConversationId = conversation.id;

          // Inicia sessão do PII Vault para esta mensagem (T0.6) e restaura os
          // bindings persistidos do turno anterior, se houver. Isso garante que
          // placeholders já presentes no histórico (`{{protocol_1}}`, etc.)
          // continuem mapeando para os valores reais no detokenize de saída.
          this.piiVault.startSession(conversation.id);
          const persistedBindings =
            await this.piiBindingService.loadPersistedPiiBindings(
              conversation.id,
            );
          if (persistedBindings?.length) {
            this.piiVault.restoreSession(conversation.id, persistedBindings);
            this.logger.debug(
              `[PII_VAULT_PERSIST] restored conv=${conversation.id} count=${persistedBindings.length}`,
            );
          }

          const normalizedInput = this.normalizeIntentText(data.body);

          const clearOutcome = this.clearContextDetector.tryHandleClearContext(
            phone,
            normalizedInput,
            conversation.id,
          );
          if (clearOutcome.status === 'prompt') {
            await this.whatsappService.sendMessage(phone, clearOutcome.message);
            return;
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
            return;
          }
          if (
            confirmationOutcome.status === 'cancelled' ||
            confirmationOutcome.status === 'reprompt'
          ) {
            await this.whatsappService.sendMessage(
              phone,
              confirmationOutcome.message,
            );
            return;
          }

          const documentHandled =
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
          if (documentHandled) return;

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
            textInput: data.body,
            transcriptionText: transcriptionContext?.text || null,
          });

          const hasTypedText = Boolean((data.body || '').trim());
          if (audioProcessing.failed && !hasTypedText) {
            const failureMessage =
              this.audioIntakeService.buildAudioFailureUserMessage(
                audioProcessing.failureReason,
              );
            await this.whatsappService.sendMessage(phone, failureMessage);
            return;
          }

          if (!userInputRaw) {
            await this.whatsappService.sendMessage(
              phone,
              'Não consegui identificar texto na sua mensagem. Se preferir, envie novamente em texto ou um áudio mais curto.',
            );
            return;
          }

          // T0.5 — pré-processador de input: tokeniza CPF/telefone/email/blocos longos.
          const userInputForAi = this.piiVault.preprocessUserInput(
            conversation.id,
            userInputRaw,
          );

          const userSource = this.resolveInboundSource(
            data.body,
            transcriptionContext,
          );

          // Histórico armazena a versão TOKENIZADA — evita re-vazar PII em
          // `buildMessagesForOpenAI` em turnos futuros.
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

          // RAG opera sobre a versão tokenizada (a base é pública, sem PII).
          // Skip para inputs triviais (confirmações, números soltos, comandos de
          // limpeza) — nesses casos o RAG não agrega valor e só adiciona latência.
          const shouldQueryRag =
            userInputForAi.trim().length >= 15 &&
            !this.clearContextDetector.isConfirmationInput(normalizedInput) &&
            !this.clearContextDetector.isCancelConfirmationInput(
              normalizedInput,
            ) &&
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

          const updatedConv =
            await this.conversationService.getOrCreateConversation(
              phone,
              userId,
              ownerId,
            );

          const accessibleDoctorsInfo =
            await this.resolveAccessibleDoctorsInfo(accessibleDoctorIds);

          const built = await this.contextService.buildContext({
            conversation: updatedConv,
            ragContext: ragContext || null,
            userInfo: {
              id: userId,
              name: user?.name ?? null,
              role: user?.role ?? null,
              isDoctor:
                Boolean(user?.doctorProfile?.id) || Boolean(user?.isDoctor),
              ownerId,
              accessibleDoctors: accessibleDoctorsInfo,
            },
          });
          const messages: OpenAI.ChatCompletionMessageParam[] = built.messages;
          const contextBreakdown = built.breakdown;
          const contextStrategy = built.strategy;

          // Interpretação determinística de resposta numérica: se o usuário só
          // enviou "2" (e variações curtas) e a última mensagem do assistente
          // tinha "Próximos passos" numerados, injeta um system hint imperativo
          // dizendo qual opção foi escolhida — sem isso o LLM volta a responder
          // "não ficou claro qual ação" mesmo com a regra no prompt.
          const numericHint =
            await this.confirmationManager.buildNumericChoiceHint(
              conversation.id,
              data.body || '',
            );
          if (numericHint) {
            // Insere logo após o último bloco system inicial, antes da janela
            // recente de mensagens — assim o LLM lê o hint como configuração de
            // turno, não como mais um item da conversa.
            let insertAt = messages.length;
            for (let i = 0; i < messages.length; i++) {
              if (messages[i].role !== 'system') {
                insertAt = i;
                break;
              }
            }
            messages.splice(insertAt, 0, {
              role: 'system',
              content: numericHint,
            });
            this.logger.log(
              `[NUMERIC_CHOICE] sid=${data.messageSid} conv=${conversation.id} injected=true`,
            );
          }

          // Confirmação determinística de operação pendente: se o usuário disse
          // "sim/confirmo/ok" e o turno anterior gravou pending_confirmation no
          // conversation_memory (tool de mutação chamada com confirm:false),
          // injeta um hint imperativo dizendo qual tool re-chamar com confirm:true.
          // Sem isso, o LLM frequentemente esquece a operação pendente e responde
          // "não ficou claro o que confirmou".
          const confirmationHint =
            await this.confirmationManager.buildPendingConfirmationHint(
              conversation.id,
              data.body || '',
            );
          if (confirmationHint) {
            let insertAt = messages.length;
            for (let i = 0; i < messages.length; i++) {
              if (messages[i].role !== 'system') {
                insertAt = i;
                break;
              }
            }
            messages.splice(insertAt, 0, {
              role: 'system',
              content: confirmationHint,
            });
            this.logger.log(
              `[PENDING_CONFIRMATION] sid=${data.messageSid} conv=${conversation.id} injected=true`,
            );
          }

          // Hint determinístico para documento pendente (Sprint 4 — fix loop):
          // se há `pending` com classification ativa, injeta no system prompt o
          // resumo dos dados extraídos + instrução clara de qual tool chamar
          // dada a intent declarada (`attach`, `create_sc`, `create_patient`).
          // Sem isso o LLM "esquece" o documento e responde "não ficou claro
          // qual ação você quer confirmar" mesmo após o usuário dizer "sim".
          const documentHint =
            await this.documentIntakeService.buildDocumentPendingHint(phone);
          if (documentHint) {
            let insertAt = messages.length;
            for (let i = 0; i < messages.length; i++) {
              if (messages[i].role !== 'system') {
                insertAt = i;
                break;
              }
            }
            messages.splice(insertAt, 0, {
              role: 'system',
              content: documentHint,
            });
            this.logger.log(
              `[AI_DOC_PENDING_HINT] sid=${data.messageSid} conv=${conversation.id} injected=true`,
            );
          }

          // Filtra tools pelo draft ativo para não estourar o limite de 128
          // tools por request da OpenAI (temos 138 registradas). Recalculamos
          // antes de cada chamada porque `plan_actions` pode abrir um draft
          // entre iterações.
          const initialDraftCtx = await this.buildToolsForCurrentDraft(
            conversation.id,
          );
          const tools = initialDraftCtx.tools;
          let activeDraftType = initialDraftCtx.draftType;

          this.ensureWithinTimeout(processStartedAt, processTimeoutMs);
          // T0.7 — redator defensivo antes da primeira chamada à IA.
          await this.piiBindingService.redactResidualPii(messages, {
            conversationId: conversation.id,
            messageSid: data.messageSid,
          });
          const t0Initial = Date.now();
          let promptCacheKey = this.buildPromptCacheKey(activeDraftType);
          const completion = await this.openaiService.chatCompletion({
            messages,
            tools,
            temperature: 0.2,
            maxTokens: this.getResponseMaxTokens(),
            timeoutMs: this.getRemainingTimeoutMs(
              processStartedAt,
              processTimeoutMs,
            ),
            cacheKey: promptCacheKey,
          });
          this.telemetry.captureUsageSnapshot(
            usageSnapshots,
            'initial',
            completion,
            Date.now() - t0Initial,
            {
              breakdown: contextBreakdown,
              strategy: contextStrategy,
              toolsCount: tools.length,
              draftType: activeDraftType,
              cacheKey: promptCacheKey,
              rag: ragMetrics ?? undefined,
            },
          );
          let responseMessage = completion.choices[0].message;

          const toolContext: ToolContext = {
            userId,
            phone,
            accessibleDoctorIds,
            ownerId,
            conversationId: conversation.id,
            inboundMedia: data.media || [],
            piiVault: this.piiVault,
          };

          const loopResult = await this.toolLoopRunner.run({
            messages,
            initialResponseMessage: responseMessage,
            toolContext,
            conversationId: conversation.id,
            messageSid: data.messageSid,
            usageSnapshots,
            initialActiveDraftType: activeDraftType,
            initialPromptCacheKey: promptCacheKey,
            processStartedAt,
            processTimeoutMs,
            hooks: {
              evaluatePlanFirstGuard: (toolCalls, conversationId) =>
                this.evaluatePlanFirstGuard(toolCalls, conversationId),
              memorizeEntitiesFromToolCall: (input) =>
                this.memorizeEntitiesFromToolCall(input),
              appendNextStepIfNeeded: (functionName, args, output, ctx) =>
                this.appendNextStepIfNeeded(functionName, args, output, ctx),
              redactResidualPii: (msgs, ctx) =>
                this.piiBindingService.redactResidualPii(msgs, ctx),
              buildToolsForCurrentDraft: (conversationId) =>
                this.buildToolsForCurrentDraft(conversationId),
              buildPromptCacheKey: (draftType) =>
                this.buildPromptCacheKey(draftType),
              getResponseMaxTokens: () => this.getResponseMaxTokens(),
              getRemainingTimeoutMs: (started, total) =>
                this.getRemainingTimeoutMs(started, total),
            },
          });

          responseMessage = loopResult.responseMessage;
          activeDraftType = loopResult.activeDraftType;
          promptCacheKey = loopResult.promptCacheKey;
          const loopLimitReached = loopResult.loopLimitReached;

          let finalText = loopLimitReached
            ? 'Não consegui completar a operação neste turno. Por favor, tente reformular sua solicitação ou envie-a em partes menores.'
            : responseMessage.content ||
              'Desculpe, não consegui processar sua solicitação.';

          finalText = this.responseNormalizer.normalizeWhatsappText(finalText);

          if (finalText.length > MAX_RESPONSE_LENGTH) {
            finalText =
              finalText.slice(0, MAX_RESPONSE_LENGTH - 60) +
              '...\n\n_Acesse a plataforma para ver a resposta completa._';
          }

          // Histórico mantém versão TOKENIZADA + literais de PII (CPF/telefone/
          // email que a IA possa ter escrito como exemplo) mascarados por
          // placeholders genéricos. Sem essa máscara, exemplos do tipo
          // "use o formato 31 99999-9999" envenenam o histórico e fazem
          // `assertNoResidualPii` bloquear todos os turnos seguintes.
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

          // T0.6 — detokeniza somente para envio externo (WhatsApp). Usa o texto
          // original (com placeholders), não o sanitizado para histórico.
          const detokenizedText = this.piiVault.detokenize(
            conversation.id,
            finalText,
          );
          const scrubbedText =
            this.responseNormalizer.scrubResidualPlaceholders(
              detokenizedText,
              conversation.id,
              data.messageSid,
            );
          // Defesa final contra duplicação de prefixo "SC-" que pode ter sido
          // produzida pela IA (ex.: alucinação "SC-SC-{{protocol_n}}"). Garante
          // que o usuário sempre recebe "SC-468131", nunca "SC-SC-468131".
          const safeText = this.collapseDuplicatedScInText(
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

          this.telemetry.logUsageSummary(
            phone,
            data.messageSid,
            usageSnapshots,
          );

          // Atualização incremental de summary/memory em background. Após 3 falhas
          // consecutivas em uma mesma conversa, `buildContext` para de injetar
          // summary/memory automaticamente (circuit breaker).
          const ctxService = this.contextService;
          const convId = conversation.id;
          Promise.resolve()
            .then(async () => {
              const conv =
                await this.conversationService.getOrCreateConversation(
                  phone,
                  userId,
                  ownerId,
                );
              if (await ctxService.shouldRefreshSummary(conv)) {
                await ctxService.updateSummaryAndMemory(convId);
              }
            })
            .catch((err) => {
              this.logger.warn(
                `[CONTEXT_SUMMARY] background_failed conv=${convId} err=${err?.message || err}`,
              );
            });

          // T0.11 — métrica/contador de PII por categoria nesta sessão.
          this.logPiiVaultUsage(data.messageSid, conversation.id);

          this.logger.log(
            `Resposta enviada para ${maskedPhone} (${safeText.length} chars)`,
          );
        } catch (error: any) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error?.message,
          });
          this.logger.error(
            `Erro ao processar mensagem de ${maskedPhone}: ${error.message}`,
            error.stack,
          );
          const isTimeout =
            error?.code === 'AI_PROCESS_TIMEOUT' ||
            error?.code === 'ETIMEDOUT' ||
            error?.code === 'ECONNABORTED' ||
            error?.name === 'AbortError';

          let userFacingMessage =
            'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou acesse a plataforma web.';
          if (isTimeout) {
            userFacingMessage =
              'A solicitação demorou mais do que o esperado (1 min e 30 s) e foi cancelada. Tente novamente.';
          }

          await this.whatsappService.sendMessage(phone, userFacingMessage);
        } finally {
          // Persiste bindings do vault (Redis com fallback in-memory) ANTES de
          // encerrar a sessão. Sem isso, o próximo turno desta conversa carrega
          // o histórico com placeholders órfãos e o detokenize não substitui nada
          // — exatamente o bug em que a resposta chegava ao WhatsApp com
          // `{{protocol_1}}`, `{{patient_name_1}}`, etc., visíveis ao usuário.
          if (activeConversationId) {
            try {
              await this.piiBindingService.persistPiiBindings(
                activeConversationId,
              );
            } catch (err: any) {
              this.logger.debug(
                `[PII_VAULT_PERSIST] finally_failed conv=${activeConversationId} err=${err?.message || err}`,
              );
            }
            this.piiVault.endSession(activeConversationId);
          }
        }
      } catch (outerError: any) {
        span.recordException(outerError);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: outerError?.message,
        });
        throw outerError;
      } finally {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }
    }); // fim startActiveSpan 'ai.processMessage'
  }

  private getRemainingTimeoutMs(
    startedAt: number,
    totalTimeoutMs: number,
  ): number {
    const elapsed = Date.now() - startedAt;
    const remaining = totalTimeoutMs - elapsed;
    if (remaining <= 0) {
      const err: any = new Error(
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

  private normalizeIntentText(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private resolveInboundSource(
    textInput: string,
    transcriptionContext: {
      text: string;
    } | null,
  ): 'text' | 'audio' | 'text+audio' {
    const hasText = Boolean((textInput || '').trim());
    const hasAudio = Boolean(transcriptionContext?.text?.trim());

    if (hasText && hasAudio) return 'text+audio';
    if (hasAudio) return 'audio';
    return 'text';
  }

  private async trySendInteractiveConfirmationTemplate(
    phone: string,
    finalText: string,
  ): Promise<boolean> {
    if (!this.isConfirmationPrompt(finalText)) return false;

    const contentSid = WHATSAPP_TEMPLATES.AI_ACTION_CONFIRMATION;

    if (!contentSid) return false;

    try {
      await this.whatsappService.sendTemplate(phone, contentSid, {
        '1': finalText,
      });
      return true;
    } catch (error: any) {
      this.logger.warn(
        `Falha ao enfileirar template interativo de confirmação para ${this.phoneNormalizer.maskPhone(phone)}: ${error?.message || 'erro desconhecido'}`,
      );
      return false;
    }
  }

  private isConfirmationPrompt(text: string): boolean {
    const normalized = this.normalizeIntentText(text || '');
    if (!normalized) return false;

    return (
      normalized.includes('confirme com "sim" para executar') ||
      normalized.includes('responda "sim" para confirmar') ||
      normalized.includes('responda sim para confirmar') ||
      normalized.includes('deseja que eu execute essa acao agora') ||
      normalized.includes('deseja confirmar')
    );
  }

  private isSuccessfulMutationResult(output: string): boolean {
    const text = (output || '').toLowerCase();
    if (!text.trim()) return false;

    const hasFailureSignal =
      text.includes('erro') ||
      text.includes('inválid') ||
      text.includes('não encontrada') ||
      text.includes('nao encontrada') ||
      text.includes('permissão') ||
      text.includes('acesso negado') ||
      text.includes('confirme com "sim"') ||
      text.includes('deseja confirmar');

    if (hasFailureSignal) return false;

    return (
      text.includes('sucesso') ||
      text.includes('criada') ||
      text.includes('atualizada') ||
      text.includes('confirmad') ||
      text.includes('registrad') ||
      text.includes('avançad') ||
      text.includes('marcada')
    );
  }

  private mapPendencyToAction(key: string): {
    action: string;
    minParams: string[];
  } {
    switch (key) {
      case 'patient_data':
        return {
          action:
            'plan_actions(intent="update_sc") + draft_update({ fields: { requestId, scope: "patient", field, value } }) + update_sc_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'field', 'value'],
        };
      case 'hospital_data':
        return {
          action: 'set_hospital',
          minParams: ['surgeryRequestId', 'hospital_name'],
        };
      case 'tuss_procedures':
        return {
          action: 'add_tuss_item',
          minParams: ['surgeryRequestId', 'tussCode', 'name'],
        };
      case 'opme_items':
        return {
          action: 'set_has_opme ou add_opme_item',
          minParams: ['surgeryRequestId', 'hasOpme=true|false'],
        };
      case 'medical_report':
        return {
          action: 'manage_report_sections',
          minParams: ['surgeryRequestId', 'operation=create', 'title'],
        };
      case 'schedule_dates':
        return {
          action:
            'plan_actions(intent="scheduling") + draft_update({ fields: { requestId, dateOptions } }) + scheduling_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'date_options[]'],
        };
      case 'confirm_date':
        return {
          action:
            'plan_actions(intent="scheduling") + draft_update({ fields: { requestId, confirmedDate } }) + scheduling_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'confirmed_date_index'],
        };
      case 'confirm_receipt':
        return {
          action: 'confirm_receipt',
          minParams: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
        };
      default:
        if (key.startsWith('doc_')) {
          return {
            action: 'attach_document_from_whatsapp',
            minParams: ['surgeryRequestId', 'document_type?', 'confirm=true'],
          };
        }
        return {
          action: 'get_pendencies',
          minParams: ['surgeryRequestId'],
        };
    }
  }

  private async appendNextStepIfNeeded(
    toolName: string,
    args: Record<string, any>,
    toolOutput: string,
    context: ToolContext,
  ): Promise<string> {
    if (!MUTATION_TOOL_NAMES.has(toolName)) return toolOutput;
    if (args.confirm !== true) return toolOutput;
    if (!this.isSuccessfulMutationResult(toolOutput)) return toolOutput;

    const requestId =
      typeof args.surgeryRequestId === 'string'
        ? args.surgeryRequestId
        : typeof args.id === 'string'
          ? args.id
          : '';

    if (!requestId) return toolOutput;

    try {
      const request = await this.surgeryRequestRepo.findOneSimple({
        id: requestId,
      });
      if (!request) return toolOutput;
      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return toolOutput;
      }

      const validation =
        await this.pendencyValidator.validateForStatus(requestId);
      const pending = validation.pendencies.filter(
        (item) => !item.isComplete && !item.isOptional,
      );

      if (!pending.length) {
        return `${toolOutput}\n\nPróximo passo recomendado:\nA solicitação está sem pendências bloqueantes. Posso executar advance_surgery_request com confirm=true.`;
      }

      const next = pending[0];
      const recommendation = this.mapPendencyToAction(next.key);
      return `${toolOutput}\n\nPróximo passo recomendado:\nPendência atual: ${next.name}.\nAção recomendada: ${recommendation.action}.\nParâmetros mínimos: ${recommendation.minParams.join(', ')}.\nDeseja que eu execute essa ação agora?`;
    } catch {
      return toolOutput;
    }
  }
}
