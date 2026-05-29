import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { context, propagation } from '@opentelemetry/api';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from '../openai.service';
import { WhatsappService } from '../../../whatsapp/whatsapp.service';
import { RagService } from '../../../rag/rag.service';
import { PiiVaultService } from '../pii-vault.service';
import { AiRedisService } from '../ai-redis.service';
import { PhoneNormalizerService } from './phone-normalizer.service';
import { ResponseNormalizerService } from './response-normalizer.service';
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../../prompts/system-prompt';
import { User } from '../../../../database/entities/user.entity';

const AI_CONSENT_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const AI_CONSENT_PORTAL_PATH = '/configuracoes/privacidade';
const AI_CONSENT_DEFAULT_PORTAL_URL = `https://app.inexci.com${AI_CONSENT_PORTAL_PATH}`;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SimpleUserCache {
  private store = new Map<string, CacheEntry<any>>();

  get(key: string): any {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: any, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

export interface InboundMessageData {
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
}

export interface PreflightInput {
  phone: string;
  lookupCandidates: string[];
  body: string;
  messageSid: string;
  processStartedAt: number;
  processTimeoutMs: number;
}

export interface PreflightHooks {
  /** Redator defensivo aplicado a mensagens antes do `tryAnswerLimitedFaq`. */
  redactResidualPii: (
    messages: OpenAI.ChatCompletionMessageParam[],
    ctx: { conversationId: string; messageSid: string },
  ) => Promise<void>;
  /** Wrapper opcional para `getRemainingTimeoutMs` do orchestrator. */
  getRemainingTimeoutMs?: (startedAt: number, totalTimeoutMs: number) => number;
}

export type PreflightOutcome =
  | { status: 'rate_limited' }
  | { status: 'unknown_user' }
  | { status: 'consent_block'; mode: 'limited_faq' | 'notice' | 'suppressed' }
  | { status: 'continue'; user: User; userId: string };

/**
 * Orquestra o pré-fluxo de toda mensagem inbound do WhatsApp:
 *
 *  1. Enfileiramento (`enqueueInboundMessage`).
 *  2. Rate limit por telefone (Redis com fallback in-memory).
 *  3. Lookup de usuário (cacheado).
 *  4. Resposta determinística para usuário desconhecido (`handleUnknownUser`).
 *  5. Gate de consentimento de IA — `tryAnswerLimitedFaq` (modo RAG-only) e
 *     notice cooldown.
 *
 * Quando o pré-fluxo finaliza a mensagem (rate limit, unknown user, consent),
 * o orchestrator não precisa fazer mais nada. Caso contrário, devolve o
 * `User` resolvido para o orchestrator continuar com PII vault, RAG, contexto
 * e tool loop.
 */
@Injectable()
export class MessageProcessorService {
  private readonly logger = new Logger(MessageProcessorService.name);
  private readonly userCache = new SimpleUserCache();
  private readonly rateLimitCounts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly aiConsentNoticesSent = new Map<string, number>();

  constructor(
    @InjectQueue('ai-messages') private readonly aiQueue: Queue,
    private readonly configService: ConfigService,
    private readonly aiRedis: AiRedisService,
    private readonly whatsappService: WhatsappService,
    private readonly openaiService: OpenaiService,
    private readonly ragService: RagService,
    private readonly piiVault: PiiVaultService,
    private readonly phoneNormalizer: PhoneNormalizerService,
    private readonly responseNormalizer: ResponseNormalizerService,
  ) {}

  async enqueueInboundMessage(data: InboundMessageData): Promise<void> {
    // Injeta o trace context do OTel no payload do job para que o worker
    // consiga restaurar o span pai e manter o trace contínuo (tarefa 8.6).
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    await this.aiQueue.add(
      'process-message',
      { ...data, _otelCarrier: carrier },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
      },
    );
  }

  async runPreflight(
    input: PreflightInput,
    hooks: PreflightHooks,
  ): Promise<PreflightOutcome> {
    const { phone, lookupCandidates, body, messageSid } = input;
    const maskedPhone = this.phoneNormalizer.maskPhone(phone);

    if (!(await this.checkRateLimitAsync(phone))) {
      this.logger.warn(`Rate limit excedido para ${maskedPhone}`);
      await this.whatsappService.sendMessage(
        phone,
        'Você enviou mensagens em ritmo muito alto. Por favor, aguarde alguns instantes antes de tentar novamente.',
      );
      return { status: 'rate_limited' };
    }

    const cachedUser = this.userCache.get(phone);
    const user =
      cachedUser ??
      (await this.phoneNormalizer.findUserByPhoneCandidates(
        phone,
        lookupCandidates,
      ));
    if (user && !cachedUser) this.userCache.set(phone, user, 10 * 60 * 1000);

    const userId = user?.id || null;

    if (!userId) {
      await this.handleUnknownUser(
        phone,
        body,
        input.processStartedAt,
        input.processTimeoutMs,
        hooks,
      );
      return { status: 'unknown_user' };
    }

    if (!this.hasValidAiConsent(user)) {
      const handled = await this.tryAnswerLimitedFaq(
        phone,
        body || '',
        messageSid,
        hooks,
      );
      if (handled) {
        this.logger.log(
          `[AI_CONSENT_BLOCK] sid=${messageSid} user=${userId} phone=${maskedPhone} mode=limited_faq`,
        );
        return { status: 'consent_block', mode: 'limited_faq' };
      }
      if (!this.hasRecentlyNoticedAiConsent(phone)) {
        await this.whatsappService.sendMessage(
          phone,
          this.buildAiConsentMissingMessage(),
        );
        this.markAiConsentNoticeSent(phone);
        this.logger.log(
          `[AI_CONSENT_BLOCK] sid=${messageSid} user=${userId} phone=${maskedPhone} notice_sent=true`,
        );
        return { status: 'consent_block', mode: 'notice' };
      }
      this.logger.debug(
        `[AI_CONSENT_BLOCK] sid=${messageSid} user=${userId} phone=${maskedPhone} notice_suppressed=true`,
      );
      return { status: 'consent_block', mode: 'suppressed' };
    }

    return { status: 'continue', user, userId };
  }

  invalidateUserCacheByPhone(phone: string | null | undefined): void {
    if (!phone) return;
    const { canonicalPhone, lookupCandidates } =
      this.phoneNormalizer.normalizeInboundPhone(phone);
    const candidates = new Set<string>([canonicalPhone, ...lookupCandidates]);
    for (const candidate of candidates) {
      this.userCache.delete(candidate);
      this.aiConsentNoticesSent.delete(candidate);
    }
  }

  hasValidAiConsent(
    user: Pick<User, 'aiConsentAcceptedAt'> | null | undefined,
  ): boolean {
    return Boolean(user?.aiConsentAcceptedAt);
  }

  buildAiConsentMissingMessage(): string {
    const dashboardUrl = this.configService
      .get<string>('DASHBOARD_URL')
      ?.trim();
    const normalizedDashboardUrl = dashboardUrl?.replace(/\/+$/, '');

    const portalUrl = normalizedDashboardUrl
      ? `${normalizedDashboardUrl}${AI_CONSENT_PORTAL_PATH}`
      : AI_CONSENT_DEFAULT_PORTAL_URL;
    return [
      'Olá! Para conversar de forma assistida sobre suas solicitações cirúrgicas e pacientes pelo WhatsApp, é preciso ativar o assistente de Inteligência Artificial na plataforma web.',
      '',
      `Acesse ${portalUrl} para ativar — leva menos de 1 minuto.`,
      '',
      'Mesmo sem ativar a IA, você continua:',
      '• Recebendo os avisos automáticos sobre suas SCs (status, agendamento, faturamento);',
      '• Podendo me perguntar dúvidas gerais sobre como usar a Inexci (eu respondo a partir da nossa base de ajuda, sem trafegar dados de pacientes ou solicitações).',
    ].join('\n');
  }

  hasRecentlyNoticedAiConsent(phone: string): boolean {
    const sentAt = this.aiConsentNoticesSent.get(phone);
    if (!sentAt) return false;
    if (Date.now() - sentAt > AI_CONSENT_NOTICE_COOLDOWN_MS) {
      this.aiConsentNoticesSent.delete(phone);
      return false;
    }
    return true;
  }

  markAiConsentNoticeSent(phone: string): void {
    this.aiConsentNoticesSent.set(phone, Date.now());
  }

  inputContainsPii(rawInput: string, processedInput: string): boolean {
    if (!processedInput) return false;
    if (rawInput === processedInput) return false;
    return /\{\{[a-z_]+_\d+\}\}/i.test(processedInput);
  }

  async tryAnswerLimitedFaq(
    phone: string,
    rawInput: string,
    messageSid: string,
    hooks: PreflightHooks,
  ): Promise<boolean> {
    const text = (rawInput || '').trim();
    if (!text) return false;
    if (text.length < 8) return false;

    const sessionId = `faq:${phone}`;
    this.piiVault.startSession(sessionId);
    try {
      const processed = this.piiVault.preprocessUserInput(sessionId, text);
      if (this.inputContainsPii(text, processed)) {
        this.logger.log(
          `[AI_LIMITED_FAQ] sid=${messageSid} phone=${this.phoneNormalizer.maskPhone(phone)} skipped=pii_detected`,
        );
        return false;
      }

      let ragResults: any[] = [];
      try {
        ragResults =
          (await this.ragService.search(processed, {
            topK: 3,
            minScore: 0.7,
          })) ?? [];
      } catch (err) {
        this.logger.warn(
          `[AI_LIMITED_FAQ] sid=${messageSid} rag_error=${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
      if (!ragResults.length) {
        this.logger.log(
          `[AI_LIMITED_FAQ] sid=${messageSid} phone=${this.phoneNormalizer.maskPhone(phone)} skipped=no_rag_hits`,
        );
        return false;
      }

      const ragContext = await this.ragService.formatContext(ragResults);

      const systemPrompt = [
        'Você é o assistente de suporte da Inexci no WhatsApp.',
        'Responda APENAS com base no CONTEXTO abaixo, que vem da nossa base oficial de ajuda.',
        'Se a pergunta NÃO puder ser respondida pelo contexto, peça ao usuário para acessar a plataforma web e ativar o assistente de IA, sem inventar.',
        'Nunca solicite ou invente dados pessoais ou clínicos. Se o usuário enviar nome de paciente, CPF, telefone, e-mail, número de SC ou qualquer dado sensível, recuse cordialmente e peça para usar a plataforma web.',
        'Não fale como um humano da Inexci; fale como assistente automatizado.',
        'Resposta em português, curta (máx. 800 caracteres), tom cordial.',
      ].join(' ');

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'system',
          content: `CONTEXTO DA BASE DE CONHECIMENTO:\n${ragContext}`,
        },
        { role: 'user', content: processed },
      ];

      await hooks.redactResidualPii(messages, {
        conversationId: sessionId,
        messageSid,
      });

      const t0 = Date.now();
      const completion = await this.openaiService.chatCompletion({
        messages,
        temperature: 0.2,
        timeoutMs: 20000,
        cacheKey: `inexci:wa:v${PROMPT_VERSION}:limited_faq`,
      });

      const answer = completion?.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        this.logger.warn(
          `[AI_LIMITED_FAQ] sid=${messageSid} empty_completion latency=${Date.now() - t0}ms`,
        );
        return false;
      }

      const safeAnswer = this.responseNormalizer.scrubResidualPlaceholders(
        answer,
        sessionId,
        messageSid,
      );

      await this.whatsappService.sendMessage(phone, safeAnswer);
      this.logger.log(
        `[AI_LIMITED_FAQ] sid=${messageSid} phone=${this.phoneNormalizer.maskPhone(phone)} answered=true latency=${Date.now() - t0}ms`,
      );
      return true;
    } finally {
      this.piiVault.endSession(sessionId);
    }
  }

  async handleUnknownUser(
    phone: string,
    message: string,
    processStartedAt?: number,
    processTimeoutMs?: number,
    hooks?: PreflightHooks,
  ): Promise<void> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content:
          'ATENÇÃO: Este usuário NÃO está cadastrado no sistema. Responda APENAS perguntas gerais sobre a Inexci. NÃO use nenhuma ferramenta. Oriente-o a se cadastrar na plataforma web para acessar funcionalidades completas.',
      },
      { role: 'user', content: message },
    ];

    const completion = await this.openaiService.chatCompletion({
      messages,
      timeoutMs:
        processStartedAt && processTimeoutMs && hooks?.getRemainingTimeoutMs
          ? hooks.getRemainingTimeoutMs(processStartedAt, processTimeoutMs)
          : undefined,
      cacheKey: `inexci:wa:v${PROMPT_VERSION}:unknown_user`,
    });
    const text = this.responseNormalizer.normalizeWhatsappText(
      completion.choices[0].message.content ||
        'Olá! Para utilizar nossos serviços, você precisa estar cadastrado na plataforma Inexci.',
    );

    await this.whatsappService.sendMessage(phone, text);
  }

  private async checkRateLimitAsync(phone: string): Promise<boolean> {
    const { max, windowSec } = this.getRateLimitConfig();
    if (this.aiRedis.isAvailable) {
      return this.aiRedis.checkRateLimit(phone, max, windowSec);
    }
    return this.checkRateLimitInMemory(phone, max, windowSec);
  }

  // T32: Rate limit via Redis com fallback in-memory.
  // Janela curta (default 20 msgs / 60 s) para proteger contra flood real
  // sem atrapalhar fluxos de cadastro/conversa, em que cada turno (texto,
  // áudio, confirmação) conta como 1 mensagem. Configurável via env:
  //   AI_RATELIMIT_MAX           (default 20)
  //   AI_RATELIMIT_WINDOW_SEC    (default 60)
  private getRateLimitConfig(): { max: number; windowSec: number } {
    const max = Math.max(
      1,
      Math.floor(
        Number(this.configService.get<number>('AI_RATELIMIT_MAX', 20)) || 20,
      ),
    );
    const windowSec = Math.max(
      1,
      Math.floor(
        Number(this.configService.get<number>('AI_RATELIMIT_WINDOW_SEC', 60)) ||
          60,
      ),
    );
    return { max, windowSec };
  }

  private checkRateLimitInMemory(
    phone: string,
    max: number,
    windowSec: number,
  ): boolean {
    const now = Date.now();
    const entry = this.rateLimitCounts.get(phone);

    if (!entry || now > entry.resetAt) {
      this.rateLimitCounts.set(phone, {
        count: 1,
        resetAt: now + windowSec * 1000,
      });
      return true;
    }

    entry.count++;
    return entry.count <= max;
  }
}
