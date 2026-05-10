import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { ConversationService } from './conversation.service';
import {
  ConversationContextService,
  ContextStrategy,
} from './conversation-context.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { PiiVaultService, SerializedPiiBindings } from './pii-vault.service';
import { AiRedisService } from './ai-redis.service';
import { RagService } from '../../rag/rag.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { UserRepository } from '../../../database/repositories/user.repository';
import { User } from '../../../database/entities/user.entity';
import { AccessControlService } from '../../services/access-control.service';
import { ToolContext } from '../tools/tool.interface';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';
import { AiPiiRedactionLogRepository } from '../../../database/repositories/ai-pii-redaction-log.repository';
import { hashPhone } from '../../crypto/phone-hash.util';
import { maskPhone as maskPhoneUtil } from '../../utils/mask.util';
import { TranscriptionService } from '../transcription/transcription.service';
import {
  InboundWhatsappMedia,
  WhatsappMediaService,
  WhatsappMediaValidationError,
} from '../../whatsapp/whatsapp-media.service';
import { WHATSAPP_TEMPLATES } from '../../whatsapp/whatsapp-templates.constants';
import { collapseDuplicatedScPrefixes } from '../tools/protocol.helpers';

const MAX_TOOL_ITERATIONS = 5;
const MAX_RESPONSE_LENGTH = 1000;
const WHATSAPP_TARGET_LENGTH = 850;
// Limite "macio" de emojis por resposta para manter o tom amigável sem
// transformar a mensagem em uma parede de figuras. Excedentes são removidos
// silenciosamente preservando o texto.
const MAX_EMOJIS_PER_RESPONSE = 3;
const CLEAR_CONTEXT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const AI_CONSENT_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const AI_CONSENT_PORTAL_PATH = '/configuracoes/privacidade';
const AI_CONSENT_DEFAULT_PORTAL_URL = `https://app.inexci.com${AI_CONSENT_PORTAL_PATH}`;
// TTL dos bindings do PII vault entre turnos da mesma conversa.
// Maior que `AI_SESSION_TIMEOUT_MINUTES` (default 30 min) para tolerar
// pequenas variações de janela; valores expirados são reconstituídos pela
// próxima execução da tool relevante.
const PII_VAULT_PERSIST_TTL_SECONDS = 60 * 60;
const PII_VAULT_REDIS_KEY_PREFIX = 'pii:vault:';

const CLEAR_CONTEXT_EXACT_COMMANDS = new Set<string>([
  'limpar contexto',
  'limpar o contexto',
  'limpar conversa',
  'limpar a conversa',
  'limpar contexto da conversa',
  'limpar historico',
  'limpar histórico',
  'limpar o historico',
  'limpar o histórico',
  'limpar historico da conversa',
  'limpar histórico da conversa',
  'limpar chat',
  'limpar o chat',
  'apagar contexto',
  'apagar historico',
  'apagar histórico',
  'resetar contexto',
  'resetar conversa',
  'sair da conversa',
  'sair do chat',
  'encerrar conversa',
  'encerrar chat',
  'fechar conversa',
  'nova conversa',
  'comecar nova conversa',
  'começar nova conversa',
  'finalizar conversa',
]);

interface CompletionUsageSnapshot {
  stage: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  latencyMs?: number;
  /** Breakdown por bloco do contexto montado (apenas no estágio inicial). */
  contextBreakdown?: {
    system_tokens: number;
    summary_tokens: number;
    memory_tokens: number;
    rag_tokens: number;
    recent_tokens: number;
    totalTokens: number;
  };
  /** Estratégia aplicada (`history_only` vs `hybrid`). */
  contextStrategy?: ContextStrategy;
}

const SC_CREATE_TOOL = 'create_surgery_request_from_whatsapp';

/**
 * Slots obrigatórios por intent que cobrem mutações sensíveis do fluxo.
 * Definidos por config; o orchestrator bloqueia a tool de criação quando
 * algum slot ainda não foi confirmado em `conversationMemory.filled_slots`.
 */
const REQUIRED_SLOTS_BY_INTENT: Record<string, string[]> = {
  create: [
    'patient.id',
    'surgeryRequest.hospital',
    'surgeryRequest.healthPlan',
    'tussItems',
  ],
  update: ['surgeryRequest.id'],
  advance: ['surgeryRequest.id'],
};

/**
 * Mapeamento entre slots e mensagens curtas de cobrança ao usuário.
 * Cada item do `pending_actions` adicionado pelo orchestrator vira UMA pergunta
 * por vez (a primeira que aparecer faltando), evitando "rajadas" de perguntas.
 */
const SLOT_PROMPTS: Record<string, string> = {
  'patient.id':
    'Antes de criar a solicitação, qual paciente devo usar? Pode me passar o nome ou o CPF (já cadastrado).',
  'surgeryRequest.hospital': 'Qual hospital vamos indicar nesta solicitação?',
  'surgeryRequest.healthPlan': 'Qual convênio vamos usar nesta solicitação?',
  tussItems:
    'Quais procedimentos (códigos TUSS ou nomes) devem entrar nessa solicitação? Pode listar pelo menos um.',
  'surgeryRequest.id':
    'Sobre qual solicitação estamos falando? Pode me dizer o protocolo (SC-XXXX) ou o nome do paciente.',
};

// Custo por 1K tokens (centavos de USD) — preços OpenAI vigentes (pode virar env var/seed)
const MODEL_COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-2024-08-06': { input: 0.25, output: 1.0 },
  'gpt-4o-2024-11-20': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-4o-mini-2024-07-18': { input: 0.015, output: 0.06 },
  'gpt-4-turbo': { input: 1.0, output: 3.0 },
  'gpt-3.5-turbo': { input: 0.05, output: 0.15 },
};

interface PendingClearContextConfirmation {
  conversationId: string;
  expiresAt: number;
}

const MUTATION_TOOL_NAMES = new Set<string>([
  'create_surgery_request_from_whatsapp',
  'create_sc_catalog_record',
  'advance_surgery_request',
  'set_has_opme',
  'close_surgery_request',
  'update_surgery_request_data',
  'confirm_date',
  'update_date_options',
  'reschedule_surgery',
  'mark_performed',
  'invoice_request',
  'confirm_receipt',
  'contest_authorization_full',
  'contest_payment',
  'update_receipt',
  'manage_report_sections',
  'update_patient_data',
  'set_hospital',
  'add_tuss_item',
  'add_opme_item',
  'update_request_clinical_data',
  'update_request_admin_data',
  'attach_document_from_whatsapp',
]);

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

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);
  private readonly userCache = new SimpleCache<any>();
  private readonly doctorIdsCache = new SimpleCache<string[]>();
  private readonly pendingClearContextByPhone = new Map<
    string,
    PendingClearContextConfirmation
  >();
  private readonly rateLimitCounts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  // Memória curta dos telefones já avisados sobre falta de consentimento de IA,
  // para não floodá-los a cada nova mensagem (T0.15 — item 4.3 do PLANO-LGPD).
  private readonly aiConsentNoticesSent = new Map<string, number>();
  // Fallback in-memory dos bindings do PII vault por conversa, usado quando
  // o Redis não estiver disponível. Preserva placeholder→valor real entre
  // turnos consecutivos para que `detokenize` funcione mesmo após reinícios
  // de sessão do vault. Em produção, a persistência primária é Redis.
  private readonly inMemoryPiiBindings = new Map<
    string,
    { bindings: SerializedPiiBindings; expiresAt: number }
  >();

  constructor(
    @InjectQueue('ai-messages') private readonly aiQueue: Queue,
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
    private readonly aiTokenUsageLogRepo: AiTokenUsageLogRepository,
    private readonly configService: ConfigService,
    private readonly transcriptionService: TranscriptionService,
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly piiVault: PiiVaultService,
    private readonly piiRedactionLogRepo: AiPiiRedactionLogRepository,
    private readonly aiRedis: AiRedisService,
    private readonly contextService: ConversationContextService,
  ) {}

  private getResponseMaxTokens(): number {
    const value = this.configService.get<number>('AI_RESPONSE_MAX_TOKENS', 450);
    return Math.max(60, Math.floor(Number(value) || 450));
  }

  /**
   * Slot-filling: se o LLM estiver tentando criar uma SC com algum slot
   * obrigatório ainda ausente, intercepta a chamada e devolve a próxima
   * pergunta determinística ao usuário (uma por vez). Slots já confirmados
   * em `conversationMemory.filled_slots` não são re-perguntados.
   */
  private evaluateSlotFilling(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined,
    conversation: { conversationMemory?: any },
    args: Record<string, any>,
  ): { missingSlot: string; prompt: string } | null {
    if (!toolCalls?.length) return null;
    const createCall = toolCalls.find(
      (call) => call.function?.name === SC_CREATE_TOOL,
    );
    if (!createCall) return null;

    const required = REQUIRED_SLOTS_BY_INTENT.create;
    const memory = conversation.conversationMemory || {};
    const filled: Record<string, unknown> = memory.filled_slots || {};

    const argsHasPath = (path: string): boolean => {
      const parts = path.split('.');
      let current: any = args;
      for (const p of parts) {
        if (current == null) return false;
        if (Array.isArray(current)) return current.length > 0;
        current = current[p];
      }
      if (current == null) return false;
      if (Array.isArray(current)) return current.length > 0;
      if (typeof current === 'string') return current.trim().length > 0;
      return Boolean(current);
    };

    for (const slot of required) {
      const provided = argsHasPath(slot) || Boolean(filled[slot]);
      if (!provided) {
        return {
          missingSlot: slot,
          prompt:
            SLOT_PROMPTS[slot] ||
            'Antes de prosseguir, preciso de mais um dado para criar a solicitação. Pode me ajudar?',
        };
      }
    }

    return null;
  }

  private async persistFilledSlots(
    conversationId: string,
    args: Record<string, any>,
  ): Promise<void> {
    if (!this.contextService) return;
    try {
      const conv = await this.conversationService[
        'conversationRepo'
      ]?.findOne?.({
        id: conversationId,
      });
      if (!conv) return;
      const memory = conv.conversationMemory || {};
      const filled = { ...(memory.filled_slots || {}) };
      // Persiste apenas hashes/ids — nunca conteúdo livre.
      if (args?.patient?.id) filled['patient.id'] = String(args.patient.id);
      if (args?.surgeryRequest?.hospital)
        filled['surgeryRequest.hospital'] = '✓';
      if (args?.surgeryRequest?.healthPlan)
        filled['surgeryRequest.healthPlan'] = '✓';
      if (Array.isArray(args?.tussItems) && args.tussItems.length)
        filled['tussItems'] = `count:${args.tussItems.length}`;

      const repo = this.conversationService['conversationRepo'];
      if (repo?.update) {
        await repo.update(conversationId, {
          conversationMemory: { ...memory, filled_slots: filled },
        });
      }
    } catch (err) {
      this.logger.debug(
        `[SLOT_FILLING] persist_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Carrega bindings do PII vault persistidos no turno anterior da mesma
   * conversa. Sem isso, placeholders (`{{protocol_1}}`, `{{patient_name_1}}`…)
   * já presentes no histórico aparecem órfãos no detokenize do próximo turno
   * — exatamente o sintoma da imagem reportada pelo usuário (resposta com
   * placeholders crus chegando ao WhatsApp).
   *
   * Estratégia primária: Redis (compartilhada entre instâncias).
   * Fallback: Map in-memory com TTL local — útil em dev/teste sem Redis e
   * preserva ao menos a sessão do mesmo processo entre mensagens.
   */
  private async loadPersistedPiiBindings(
    conversationId: string,
  ): Promise<SerializedPiiBindings | null> {
    const key = `${PII_VAULT_REDIS_KEY_PREFIX}${conversationId}`;
    if (this.aiRedis.isAvailable) {
      try {
        const stored = await this.aiRedis.cacheGet<SerializedPiiBindings>(key);
        if (Array.isArray(stored)) return stored;
      } catch (err: any) {
        this.logger.debug(
          `[PII_VAULT_PERSIST] redis_load_failed conv=${conversationId} err=${err?.message || err}`,
        );
      }
    }

    const fallback = this.inMemoryPiiBindings.get(conversationId);
    if (!fallback) return null;
    if (Date.now() > fallback.expiresAt) {
      this.inMemoryPiiBindings.delete(conversationId);
      return null;
    }
    return fallback.bindings;
  }

  /**
   * Serializa o estado atual do vault para esta conversa e persiste com TTL.
   * Chamado após o detokenize da resposta final, antes de encerrar a sessão.
   */
  private async persistPiiBindings(conversationId: string): Promise<void> {
    let snapshot: SerializedPiiBindings = [];
    try {
      snapshot = this.piiVault.serializeSession(conversationId);
    } catch (err: any) {
      this.logger.debug(
        `[PII_VAULT_PERSIST] serialize_failed conv=${conversationId} err=${err?.message || err}`,
      );
      return;
    }

    if (!snapshot.length) return;

    const key = `${PII_VAULT_REDIS_KEY_PREFIX}${conversationId}`;
    if (this.aiRedis.isAvailable) {
      try {
        await this.aiRedis.cacheSet(
          key,
          snapshot,
          PII_VAULT_PERSIST_TTL_SECONDS,
        );
        return;
      } catch (err: any) {
        this.logger.debug(
          `[PII_VAULT_PERSIST] redis_save_failed conv=${conversationId} err=${err?.message || err}`,
        );
      }
    }

    this.inMemoryPiiBindings.set(conversationId, {
      bindings: snapshot,
      expiresAt: Date.now() + PII_VAULT_PERSIST_TTL_SECONDS * 1000,
    });
  }

  /**
   * Substitutos neutros usados para placeholders de PII que escapam ao
   * detokenize (geralmente alucinações da IA: ela "vê" `{{protocol_1}}` no
   * histórico e replica em uma resposta nova mesmo quando o vault da
   * categoria/índice não foi populado naquele turno). Em vez de deixar o
   * placeholder cru chegar ao WhatsApp, trocamos por um termo genérico para
   * que a frase ainda faça sentido.
   */
  private readonly RESIDUAL_PLACEHOLDER_FALLBACKS: Record<string, string> = {
    protocol: 'essa solicitação',
    patient_name: 'o paciente',
    doctor_name: 'o médico',
    hospital_name: 'o hospital',
    health_plan_name: 'o convênio',
    cpf: '[CPF não disponível]',
    phone: '[telefone não disponível]',
    email: '[e-mail não disponível]',
    address: '[endereço não disponível]',
    date: 'a data informada',
    birthDate: 'a data de nascimento',
    medicalReport: '[laudo]',
    patientHistory: '[histórico clínico]',
    diagnosis: '[diagnóstico]',
    surgeryDescription: '[descrição cirúrgica]',
    payload_blob: '[conteúdo enviado]',
  };

  /**
   * Remove qualquer placeholder `{{categoria_n}}` que tenha escapado ao
   * detokenize, evitando que o usuário receba a string crua no WhatsApp
   * (sintoma reportado pela imagem: "protocolo {{protocol_1}}").
   *
   * Causas conhecidas:
   *  - IA alucina um placeholder que nunca foi tokenizado (não há binding).
   *  - Bindings persistidos foram perdidos entre turnos (Redis indisponível +
   *    reinício de processo invalidando o fallback in-memory).
   *
   * Os placeholders são substituídos por termos neutros baseados na
   * categoria, e qualquer ocorrência é logada para investigação posterior.
   */
  private scrubResidualPlaceholders(
    text: string,
    sessionId: string,
    messageSid: string,
  ): string {
    if (!text) return text;
    const placeholderRegex = /\{\{([a-z_]+)_(\d+)\}\}/gi;
    if (!placeholderRegex.test(text)) return text;

    placeholderRegex.lastIndex = 0;
    const seen = new Map<string, number>();

    const cleaned = text.replace(placeholderRegex, (_match, category) => {
      const key = String(category || '').toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
      return (
        this.RESIDUAL_PLACEHOLDER_FALLBACKS[key] ??
        '[informação não disponível]'
      );
    });

    if (seen.size) {
      const breakdown = Array.from(seen.entries())
        .map(([cat, count]) => `${cat}=${count}`)
        .join(',');
      this.logger.warn(
        `[AI_PLACEHOLDER_LEAK] sid=${messageSid} conv=${sessionId} ${breakdown}`,
      );
    }

    return cleaned;
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
   * Mascaramento de telefones para logs (LGPD — T0/T25). Delegado ao helper
   * compartilhado em `shared/utils/mask.util` para manter o formato único
   * em todo o backend.
   */
  private maskPhone(phone: string): string {
    return maskPhoneUtil(phone);
  }

  /**
   * Verifica se o usuário já aceitou o termo de uso de IA.
   * (T0.15 — base de bloqueio do orchestrator quando consentimento ausente.)
   */
  private hasValidAiConsent(
    user: Pick<User, 'aiConsentAcceptedAt'> | null | undefined,
  ): boolean {
    return Boolean(user?.aiConsentAcceptedAt);
  }

  /** Texto-padrão de redirecionamento à web (item 4.3 do PLANO-LGPD-CONFORMIDADE). */
  private buildAiConsentMissingMessage(): string {
    const portalUrl =
      this.configService.get<string>('AI_CONSENT_PORTAL_URL') ||
      AI_CONSENT_DEFAULT_PORTAL_URL;
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

  /**
   * Detecta se o pré-processamento tokenizou alguma PII na entrada do usuário.
   * Comparamos o texto bruto com a versão pseudonimizada — qualquer placeholder
   * `{{tipo_n}}` indica que houve substituição.
   */
  private inputContainsPii(rawInput: string, processedInput: string): boolean {
    if (!processedInput) return false;
    if (rawInput === processedInput) return false;
    return /\{\{[a-z_]+_\d+\}\}/i.test(processedInput);
  }

  /**
   * Modo limitado RAG-only para usuários SEM consent de IA.
   *
   * Permite que o usuário tire dúvidas gerais sobre a Inexci (suporte / FAQ)
   * via WhatsApp sem trafegar dados de pacientes ou solicitações pelo LLM
   * externo. Comportamento:
   *
   *  1. Pré-processa a mensagem; se identificar PII, recusa (envia notice).
   *  2. Faz busca na base RAG. Sem hits relevantes → recusa.
   *  3. Chama o LLM **sem tools, sem histórico**, com system prompt restritivo.
   *  4. Filtro defensivo de PII residual (mesmo que do código existente).
   *
   * Retorna `true` se respondeu, `false` se o caller deve seguir com a notice.
   */
  private async tryAnswerLimitedFaq(
    phone: string,
    rawInput: string,
    messageSid: string,
  ): Promise<boolean> {
    const text = (rawInput || '').trim();
    if (!text) return false;
    // Mensagens muito curtas raramente são perguntas reais — evita ruído.
    if (text.length < 8) return false;

    const sessionId = `faq:${phone}`;
    this.piiVault.startSession(sessionId);
    try {
      const processed = this.preprocessUserInput(sessionId, text);
      if (this.inputContainsPii(text, processed)) {
        this.logger.log(
          `[AI_LIMITED_FAQ] sid=${messageSid} phone=${this.maskPhone(phone)} skipped=pii_detected`,
        );
        return false;
      }

      let ragResults: any[] = [];
      try {
        ragResults = (await this.ragService.search(processed, 3, 0.7)) ?? [];
      } catch (err) {
        this.logger.warn(
          `[AI_LIMITED_FAQ] sid=${messageSid} rag_error=${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
      if (!ragResults.length) {
        this.logger.log(
          `[AI_LIMITED_FAQ] sid=${messageSid} phone=${this.maskPhone(phone)} skipped=no_rag_hits`,
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

      await this.redactResidualPii(messages, {
        conversationId: sessionId,
        messageSid,
      });

      const t0 = Date.now();
      const completion = await this.openaiService.chatCompletion({
        messages,
        temperature: 0.2,
        timeoutMs: 20000,
      });

      const answer = completion?.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        this.logger.warn(
          `[AI_LIMITED_FAQ] sid=${messageSid} empty_completion latency=${Date.now() - t0}ms`,
        );
        return false;
      }

      const safeAnswer = this.scrubResidualPlaceholders(
        answer,
        sessionId,
        messageSid,
      );

      await this.whatsappService.sendMessage(phone, safeAnswer);
      this.logger.log(
        `[AI_LIMITED_FAQ] sid=${messageSid} phone=${this.maskPhone(phone)} answered=true latency=${Date.now() - t0}ms`,
      );
      return true;
    } finally {
      // Sessão temporária — limpa para não inflar a memória do vault.
      this.piiVault.endSession(sessionId);
    }
  }

  /** Evita floodar o mesmo telefone com a mensagem de consentimento ausente. */
  private hasRecentlyNoticedAiConsent(phone: string): boolean {
    const sentAt = this.aiConsentNoticesSent.get(phone);
    if (!sentAt) return false;
    if (Date.now() - sentAt > AI_CONSENT_NOTICE_COOLDOWN_MS) {
      this.aiConsentNoticesSent.delete(phone);
      return false;
    }
    return true;
  }

  private markAiConsentNoticeSent(phone: string): void {
    this.aiConsentNoticesSent.set(phone, Date.now());
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
    if (!phone) return;
    const { canonicalPhone, lookupCandidates } =
      this.normalizeInboundPhone(phone);
    const candidates = new Set<string>([canonicalPhone, ...lookupCandidates]);
    for (const candidate of candidates) {
      this.userCache.delete(candidate);
      this.aiConsentNoticesSent.delete(candidate);
    }
  }

  /**
   * Pré-processador de input do usuário (T0.5):
   * substitui CPF/telefone/email por placeholders ANTES de o texto entrar no
   * histórico ou ir para a OpenAI. Blocos muito longos viram `payload_blob`.
   */
  private preprocessUserInput(
    conversationId: string,
    rawInput: string,
  ): string {
    if (!rawInput) return '';
    let out = rawInput;

    out = out.replace(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/g, (match) =>
      this.piiVault.tokenize(conversationId, match, 'cpf'),
    );

    out = out.replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, (match) =>
      this.piiVault.tokenize(conversationId, match, 'phone'),
    );

    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (match) =>
      this.piiVault.tokenize(conversationId, match, 'email'),
    );

    if (out.length > 1500) {
      out = this.piiVault.tokenize(conversationId, out, 'payload_blob');
    }

    return out;
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

  /**
   * Filtro defensivo (T0.7 — versão "redact, don't block"): varre as
   * mensagens que serão enviadas à OpenAI e MASCARA in-place qualquer PII
   * estrutural residual (CPF, telefone BR, e-mail) por placeholders
   * genéricos (`XXX.XXX.XXX-XX`, `(DDD) NNNNN-NNNN`, `<usuario>@<dominio>`).
   *
   * Decisão de produto: o usuário NUNCA deve ser cobrado por enviar PII —
   * ele confia na plataforma para lidar com isso. Logo, o caminho antigo
   * (lançar `PII_RESIDUAL` e responder no WhatsApp com "Detectei um dado
   * sensível...") foi descartado. A garantia de que nada de PII bruto chega
   * à OpenAI continua valendo, mas via redação silenciosa.
   *
   * Mensagens com role `assistant` (histórico/follow-ups da própria IA) são
   * ignoradas pelo mesmo motivo de antes: o LLM frequentemente inclui
   * exemplos de formato e a defesa para esse caminho é
   * `sanitizeAssistantOutputForHistory`, que mascara antes de persistir.
   *
   * Cada redação é registrada em `ai_pii_redaction_log` com `blocked=false`
   * para auditoria/observabilidade.
   */
  private async redactResidualPii(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: { conversationId: string; messageSid: string; toolName?: string },
  ): Promise<void> {
    for (const message of messages) {
      if (message.role === 'assistant') continue;
      const content = message.content;
      if (typeof content !== 'string' || !content) continue;
      const findings = this.piiVault.detectResidualPii(content);
      if (!findings.length) continue;

      const masked = this.piiVault.maskLiteralPii(content);
      // Mutação in-place: o array `messages` é repassado adiante e precisa
      // refletir o conteúdo redigido antes do `chatCompletion`.
      (message as { content: string }).content = masked.text;

      const first = findings[0];
      try {
        await this.piiRedactionLogRepo.create({
          conversationId: context.conversationId,
          messageSid: context.messageSid,
          category: first.category,
          valueHash: this.piiVault.hashValue(first.sample),
          blocked: false,
          toolName: context.toolName ?? null,
          occurrences: findings.length,
        });
      } catch (logErr: any) {
        this.logger.warn(
          `Falha ao registrar pii_redaction_log: ${logErr?.message || 'erro desconhecido'}`,
        );
      }

      const breakdown = masked.masked.length
        ? masked.masked.map((m) => `${m.category}=${m.count}`).join(',')
        : findings.map((f) => f.category).join(',');
      this.logger.warn(
        `[AI_PII_REDACT] sid=${context.messageSid} role=${message.role} occurrences=${findings.length} ${breakdown}`,
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
      category: 'audio' | 'other';
      durationSeconds: number | null;
    }>;
  }): Promise<void> {
    await this.aiQueue.add('process-message', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    });
  }

  async processMessage(data: {
    from: string;
    body: string;
    messageSid: string;
    mediaUrl: string | null;
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'other';
      durationSeconds: number | null;
    }>;
  }): Promise<void> {
    const processTimeoutMs = this.configService.get<number>(
      'AI_PROCESS_TIMEOUT_MS',
      90000,
    );
    const processStartedAt = Date.now();

    const { canonicalPhone, lookupCandidates } = this.normalizeInboundPhone(
      data.from,
    );
    const phone = canonicalPhone;
    const maskedPhone = this.maskPhone(phone);
    this.logger.log(
      `Processando mensagem de ${maskedPhone} (${(data.body || '').length} chars de texto)`,
    );

    if (!(await this.checkRateLimitAsync(phone))) {
      this.logger.warn(`Rate limit excedido para ${maskedPhone}`);
      await this.whatsappService.sendMessage(
        phone,
        '⚠️ Você enviou mensagens em ritmo muito alto. Por favor, aguarde alguns instantes antes de tentar novamente.',
      );
      return;
    }

    let activeConversationId: string | null = null;

    try {
      this.ensureWithinTimeout(processStartedAt, processTimeoutMs);

      const usageSnapshots: CompletionUsageSnapshot[] = [];

      const cachedUser = this.userCache.get(phone);
      const user =
        cachedUser ??
        (await this.findUserByPhoneCandidates(phone, lookupCandidates));
      if (user && !cachedUser) this.userCache.set(phone, user, 10 * 60 * 1000); // 10 min

      const userId = user?.id || null;

      if (!userId) {
        await this.handleUnknownUser(
          phone,
          data.body,
          processStartedAt,
          processTimeoutMs,
        );
        return;
      }

      // T0.15 + ajuste 2026-05-07 — Bloqueio por ausência de consentimento de IA.
      // Antes de bloquear, tentamos responder dúvidas gerais sobre a Inexci via
      // RAG (base de conhecimento estática, sem dados de pacientes/SC). Só
      // enviamos a notice se a tentativa não couber nesse modo limitado.
      if (!this.hasValidAiConsent(user)) {
        const handled = await this.tryAnswerLimitedFaq(
          phone,
          data.body || '',
          data.messageSid,
        );
        if (handled) {
          this.logger.log(
            `[AI_CONSENT_BLOCK] sid=${data.messageSid} user=${userId} phone=${maskedPhone} mode=limited_faq`,
          );
          return;
        }
        if (!this.hasRecentlyNoticedAiConsent(phone)) {
          await this.whatsappService.sendMessage(
            phone,
            this.buildAiConsentMissingMessage(),
          );
          this.markAiConsentNoticeSent(phone);
          this.logger.log(
            `[AI_CONSENT_BLOCK] sid=${data.messageSid} user=${userId} phone=${maskedPhone} notice_sent=true`,
          );
        } else {
          this.logger.debug(
            `[AI_CONSENT_BLOCK] sid=${data.messageSid} user=${userId} phone=${maskedPhone} notice_suppressed=true`,
          );
        }
        return;
      }

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
      const persistedBindings = await this.loadPersistedPiiBindings(
        conversation.id,
      );
      if (persistedBindings?.length) {
        this.piiVault.restoreSession(conversation.id, persistedBindings);
        this.logger.debug(
          `[PII_VAULT_PERSIST] restored conv=${conversation.id} count=${persistedBindings.length}`,
        );
      }

      const normalizedInput = this.normalizeIntentText(data.body);

      if (this.isClearContextCommand(normalizedInput)) {
        this.pendingClearContextByPhone.set(phone, {
          conversationId: conversation.id,
          expiresAt: Date.now() + CLEAR_CONTEXT_CONFIRMATION_TTL_MS,
        });
        await this.whatsappService.sendMessage(
          phone,
          'Confirma que deseja limpar o contexto desta conversa? As próximas mensagens serão tratadas sem histórico anterior. Responda "sim" para confirmar ou "não" para cancelar.',
        );
        return;
      }

      const pendingClear = this.getPendingClearContext(phone);
      if (pendingClear) {
        if (this.isConfirmationInput(normalizedInput)) {
          await this.conversationService.resetConversationHistory(
            pendingClear.conversationId,
          );
          this.pendingClearContextByPhone.delete(phone);
          await this.whatsappService.sendMessage(
            phone,
            'Pronto. Limpei o contexto desta conversa. Precisa de mais alguma coisa? Se precisar, é só chamar.',
          );
          return;
        }

        if (this.isCancelConfirmationInput(normalizedInput)) {
          this.pendingClearContextByPhone.delete(phone);
          await this.whatsappService.sendMessage(
            phone,
            'Tudo bem, não limpei o contexto. Se quiser limpar depois, é só pedir.',
          );
          return;
        }

        await this.whatsappService.sendMessage(
          phone,
          'Ainda estou aguardando sua confirmação para limpar o contexto. Responda "sim" para confirmar ou "não" para cancelar.',
        );
        return;
      }

      const hasInboundAudio =
        this.isAudioEnabled() &&
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

      const audioProcessing = await this.processInboundAudioIfNeeded(data);
      const transcriptionContext = audioProcessing.transcription;

      const userInputRaw = this.buildUserInputForAi({
        textInput: data.body,
        transcriptionText: transcriptionContext?.text || null,
      });

      const hasTypedText = Boolean((data.body || '').trim());
      if (audioProcessing.failed && !hasTypedText) {
        await this.whatsappService.sendMessage(
          phone,
          '⚠️ Não consegui transcrever seu áudio desta vez. Pode tentar novamente enviando outro áudio mais curto ou, se preferir, digitar a mensagem?',
        );
        return;
      }

      if (!userInputRaw) {
        await this.whatsappService.sendMessage(
          phone,
          '⚠️ Não consegui identificar texto na sua mensagem. Se preferir, envie novamente em texto ou um áudio mais curto.',
        );
        return;
      }

      // T0.5 — pré-processador de input: tokeniza CPF/telefone/email/blocos longos.
      const userInputForAi = this.preprocessUserInput(
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
      const ragResults = await this.ragService.search(userInputForAi, 3, 0.65);
      const ragContext = await this.ragService.formatContext(ragResults);

      const updatedConv =
        await this.conversationService.getOrCreateConversation(
          phone,
          userId,
          ownerId,
        );

      const built = await this.contextService.buildContext({
        conversation: updatedConv,
        ragContext: ragContext || null,
      });
      const messages: OpenAI.ChatCompletionMessageParam[] = built.messages;
      const contextBreakdown = built.breakdown;
      const contextStrategy = built.strategy;

      const tools = this.toolRegistry.getToolDefinitions();

      this.ensureWithinTimeout(processStartedAt, processTimeoutMs);
      // T0.7 — redator defensivo antes da primeira chamada à IA.
      await this.redactResidualPii(messages, {
        conversationId: conversation.id,
        messageSid: data.messageSid,
      });
      const t0Initial = Date.now();
      const completion = await this.openaiService.chatCompletion({
        messages,
        tools,
        temperature: 0.2,
        maxTokens: this.getResponseMaxTokens(),
        timeoutMs: this.getRemainingTimeoutMs(
          processStartedAt,
          processTimeoutMs,
        ),
      });
      this.captureUsageSnapshot(
        usageSnapshots,
        'initial',
        completion,
        Date.now() - t0Initial,
        { breakdown: contextBreakdown, strategy: contextStrategy },
      );
      let responseMessage = completion.choices[0].message;

      const toolContext: ToolContext = {
        userId,
        phone,
        accessibleDoctorIds,
        conversationId: conversation.id,
        inboundMedia: data.media || [],
        piiVault: this.piiVault,
      };

      let iterations = MAX_TOOL_ITERATIONS;
      let followUpIndex = 0;
      let slotPromptOverride: string | null = null;
      while (responseMessage.tool_calls?.length && iterations > 0) {
        iterations--;

        // Slot-filling: intercepta criação de SC com slot faltante.
        const createCall = responseMessage.tool_calls.find(
          (call) => call.function?.name === SC_CREATE_TOOL,
        );
        if (createCall) {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = createCall.function?.arguments
              ? JSON.parse(createCall.function.arguments)
              : {};
          } catch {
            parsedArgs = {};
          }
          const slotCheck = this.evaluateSlotFilling(
            responseMessage.tool_calls,
            updatedConv,
            parsedArgs,
          );
          if (slotCheck) {
            slotPromptOverride = slotCheck.prompt;
            this.logger.log(
              `[SLOT_FILLING] sid=${data.messageSid} conv=${conversation.id} blocked=${SC_CREATE_TOOL} missing=${slotCheck.missingSlot}`,
            );
            break;
          }
          await this.persistFilledSlots(conversation.id, parsedArgs);
        }

        const toolResults = await this.toolExecutor.executeMany(
          responseMessage.tool_calls,
          toolContext,
        );

        const patchedToolResults = await Promise.all(
          toolResults.map(async (result) => {
            const toolCall = responseMessage.tool_calls?.find(
              (call) => call.id === result.toolCallId,
            );

            if (!toolCall) return result;

            const functionName = toolCall.function?.name || '';
            let args: Record<string, any> = {};

            try {
              args = toolCall.function?.arguments
                ? JSON.parse(toolCall.function.arguments)
                : {};
            } catch {
              return result;
            }

            const enrichedOutput = await this.appendNextStepIfNeeded(
              functionName,
              args,
              result.output,
              toolContext,
            );

            return {
              ...result,
              output: enrichedOutput,
            };
          }),
        );

        messages.push(responseMessage as OpenAI.ChatCompletionMessageParam);
        for (const result of patchedToolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content: result.output,
          });
        }

        // T0.7 — redator defensivo antes de cada follow-up.
        await this.redactResidualPii(messages, {
          conversationId: conversation.id,
          messageSid: data.messageSid,
        });

        const t0Followup = Date.now();
        const followUp = await this.openaiService.chatCompletion({
          messages,
          tools,
          temperature: 0.2,
          maxTokens: this.getResponseMaxTokens(),
          timeoutMs: this.getRemainingTimeoutMs(
            processStartedAt,
            processTimeoutMs,
          ),
        });
        followUpIndex += 1;
        this.captureUsageSnapshot(
          usageSnapshots,
          `followup_${followUpIndex}`,
          followUp,
          Date.now() - t0Followup,
        );
        responseMessage = followUp.choices[0].message;
      }

      let finalText =
        slotPromptOverride ||
        responseMessage.content ||
        'Desculpe, não consegui processar sua solicitação.';

      if (this.needsQualityRewrite(finalText)) {
        const rewriteResult = await this.rewriteForWhatsappQuality(
          finalText,
          userInputForAi,
          processStartedAt,
          processTimeoutMs,
        );
        finalText = rewriteResult.text;
        this.captureUsageSnapshot(
          usageSnapshots,
          'rewrite',
          rewriteResult.completion,
          rewriteResult.latencyMs,
        );
      }

      finalText = this.normalizeWhatsappText(finalText);

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
      const scrubbedText = this.scrubResidualPlaceholders(
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

      await this.persistUsageSummary(
        phone,
        data.messageSid,
        conversation.id,
        userId,
        ownerId,
        usageSnapshots,
      );

      this.logUsageSummary(phone, data.messageSid, usageSnapshots);

      // Atualização incremental de summary/memory em background. Após 3 falhas
      // consecutivas em uma mesma conversa, `buildContext` para de injetar
      // summary/memory automaticamente (circuit breaker).
      const ctxService = this.contextService;
      const convId = conversation.id;
      Promise.resolve()
        .then(async () => {
          const conv = await this.conversationService.getOrCreateConversation(
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
        '⚠️ Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou acesse a plataforma web.';
      if (isTimeout) {
        userFacingMessage =
          '⚠️ A solicitação demorou mais do que o esperado (1 min e 30 s) e foi cancelada. Tente novamente.';
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
          await this.persistPiiBindings(activeConversationId);
        } catch (err: any) {
          this.logger.debug(
            `[PII_VAULT_PERSIST] finally_failed conv=${activeConversationId} err=${err?.message || err}`,
          );
        }
        this.piiVault.endSession(activeConversationId);
      }
    }
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

  private async checkRateLimitAsync(phone: string): Promise<boolean> {
    const { max, windowSec } = this.getRateLimitConfig();
    if (this.aiRedis.isAvailable) {
      return this.aiRedis.checkRateLimit(phone, max, windowSec);
    }
    return this.checkRateLimitInMemory(phone, max, windowSec);
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

  private async handleUnknownUser(
    phone: string,
    message: string,
    processStartedAt?: number,
    processTimeoutMs?: number,
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
        processStartedAt && processTimeoutMs
          ? this.getRemainingTimeoutMs(processStartedAt, processTimeoutMs)
          : undefined,
    });
    const text = this.normalizeWhatsappText(
      completion.choices[0].message.content ||
        'Olá! Para utilizar nossos serviços, você precisa estar cadastrado na plataforma Inexci.',
    );

    await this.whatsappService.sendMessage(phone, text);
  }

  private needsQualityRewrite(text: string): boolean {
    if (!text) return true;

    const hasCodeBlock = text.includes('```');
    const hasMarkdownHeader = /^\s*#/m.test(text);
    const hasJsonLikePayload = /\{\s*"[^"]+"\s*:/m.test(text);
    const tooManyBreaks = (text.match(/\n/g) || []).length > 14;
    const tooLong = text.length > 1000;

    return (
      hasCodeBlock ||
      hasMarkdownHeader ||
      hasJsonLikePayload ||
      tooManyBreaks ||
      tooLong
    );
  }

  private async rewriteForWhatsappQuality(
    rawText: string,
    userInput: string,
    processStartedAt?: number,
    processTimeoutMs?: number,
  ): Promise<{
    text: string;
    completion: OpenAI.ChatCompletion | null;
    latencyMs: number;
  }> {
    const t0 = Date.now();
    try {
      const completion = await this.openaiService.chatCompletion({
        temperature: 0.1,
        maxTokens: 350,
        timeoutMs:
          processStartedAt && processTimeoutMs
            ? this.getRemainingTimeoutMs(processStartedAt, processTimeoutMs)
            : undefined,
        messages: [
          {
            role: 'system',
            content:
              'Reescreva a resposta para WhatsApp em português do Brasil, mantendo apenas os fatos já presentes. Não adicione informações novas. Use tom gentil, acolhedor e profissional, com linguagem direta e frases curtas. Pode usar no máximo 1 ou 2 emojis sutis quando agregarem clareza ou calor humano (ex.: ✅, 📅, 📋), mas nunca em todas as mensagens. Quando fizer sentido, encerre sugerindo de 2 a 4 próximos passos como opções numeradas no formato "1 - opção", uma por linha. Mire em até 8 linhas, sem markdown avançado e sem JSON.',
          },
          {
            role: 'user',
            content: `Pergunta do usuário: ${userInput}\n\nResposta bruta:\n${rawText}`,
          },
        ],
      });

      return {
        text:
          completion.choices[0]?.message?.content?.trim() ||
          rawText ||
          'Desculpe, não consegui formatar a resposta agora.',
        completion,
        latencyMs: Date.now() - t0,
      };
    } catch {
      return { text: rawText, completion: null, latencyMs: Date.now() - t0 };
    }
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

  private captureUsageSnapshot(
    snapshots: CompletionUsageSnapshot[],
    stage: string,
    completion: OpenAI.ChatCompletion | null | undefined,
    latencyMs?: number,
    extra?: {
      breakdown?: CompletionUsageSnapshot['contextBreakdown'];
      strategy?: ContextStrategy;
    },
  ): void {
    if (!completion?.usage) return;

    snapshots.push({
      stage,
      promptTokens: completion.usage.prompt_tokens || 0,
      completionTokens: completion.usage.completion_tokens || 0,
      totalTokens: completion.usage.total_tokens || 0,
      model: completion.model,
      latencyMs,
      ...(extra?.breakdown ? { contextBreakdown: extra.breakdown } : {}),
      ...(extra?.strategy ? { contextStrategy: extra.strategy } : {}),
    });
  }

  private logUsageSummary(
    phone: string,
    messageSid: string,
    snapshots: CompletionUsageSnapshot[],
  ): void {
    if (!snapshots.length) return;

    const totals = snapshots.reduce(
      (acc, item) => {
        acc.prompt += item.promptTokens;
        acc.completion += item.completionTokens;
        acc.total += item.totalTokens;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0 },
    );

    const breakdown = snapshots
      .map(
        (item) =>
          `${item.stage}(p:${item.promptTokens}, c:${item.completionTokens}, t:${item.totalTokens})`,
      )
      .join(' | ');

    const initial = snapshots.find((s) => s.stage === 'initial');
    const ctxBreakdown = initial?.contextBreakdown;
    const strategy = initial?.contextStrategy ?? 'history_only';
    const ctxLog = ctxBreakdown
      ? ` strategy=${strategy} ctx_system=${ctxBreakdown.system_tokens} ctx_summary=${ctxBreakdown.summary_tokens} ctx_memory=${ctxBreakdown.memory_tokens} ctx_rag=${ctxBreakdown.rag_tokens} ctx_recent=${ctxBreakdown.recent_tokens}`
      : ` strategy=${strategy}`;

    this.logger.log(
      `[AI_TOKEN_USAGE] sid=${messageSid} phone=${this.maskPhone(phone)} total_prompt=${totals.prompt} total_completion=${totals.completion} total=${totals.total} breakdown=${breakdown}${ctxLog}`,
    );
  }

  private async persistUsageSummary(
    phone: string,
    messageSid: string,
    conversationId: string,
    userId: string,
    ownerId: string | null,
    snapshots: CompletionUsageSnapshot[],
  ): Promise<void> {
    if (!snapshots.length) return;

    const totals = snapshots.reduce(
      (acc, item) => {
        acc.prompt += item.promptTokens;
        acc.completion += item.completionTokens;
        acc.total += item.totalTokens;
        acc.latency += item.latencyMs || 0;
        return acc;
      },
      { prompt: 0, completion: 0, total: 0, latency: 0 },
    );

    const model = snapshots[0]?.model ?? null;

    const costCents = this.estimateCostCents(snapshots);

    try {
      await this.aiTokenUsageLogRepo.create({
        messageSid,
        phoneHash: hashPhone(phone),
        conversationId,
        userId,
        ownerId,
        promptTokens: totals.prompt,
        completionTokens: totals.completion,
        totalTokens: totals.total,
        callsCount: snapshots.length,
        model,
        latencyMs: totals.latency || null,
        costEstimateCents: costCents,
        breakdown: snapshots,
      });
    } catch (error: any) {
      this.logger.warn(
        `Falha ao persistir AI_TOKEN_USAGE sid=${messageSid}: ${error?.message || 'erro desconhecido'}`,
      );
    }
  }

  private estimateCostCents(
    snapshots: CompletionUsageSnapshot[],
  ): number | null {
    let total = 0;
    let hasPricing = false;
    for (const s of snapshots) {
      const pricing = s.model ? MODEL_COST_PER_1K[s.model] : undefined;
      if (!pricing) continue;
      hasPricing = true;
      total +=
        (s.promptTokens / 1000) * pricing.input +
        (s.completionTokens / 1000) * pricing.output;
    }
    return hasPricing ? Math.round(total) : null;
  }

  private normalizeWhatsappText(text: string): string {
    const limitedEmojiText = this.limitEmojis(
      text || '',
      MAX_EMOJIS_PER_RESPONSE,
    );
    const normalizedLines = limitedEmojiText
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
      .map((line) => {
        let current = line;
        current = current.replace(/^#+\s*/g, '');
        current = current.replace(/^[-*]\s+/g, '• ');
        current = current.replace(/\*(.*?)\*/g, '$1');
        current = current.replace(/\s{2,}/g, ' ');
        return current;
      });

    const optionLines = this.convertListLinesToOptions(normalizedLines);

    let output = optionLines.join('\n').trim();

    if (
      (output.startsWith('"') && output.endsWith('"')) ||
      (output.startsWith("'") && output.endsWith("'"))
    ) {
      output = output.slice(1, -1).trim();
    }

    if (!output) {
      output = 'Desculpe, não consegui processar sua solicitação.';
    }

    if (output.length > WHATSAPP_TARGET_LENGTH) {
      output =
        output.slice(0, WHATSAPP_TARGET_LENGTH - 45).trimEnd() +
        '\n\n_Acesse a plataforma para mais detalhes._';
    }

    return output;
  }

  /**
   * Limita o número de emojis no texto a `max` ocorrências. Emojis adicionais
   * são removidos preservando o conteúdo textual ao redor. Combina o caractere
   * pictográfico Unicode com o seletor de variação `\uFE0F` (presente em
   * emojis monocromáticos como "ℹ️") para garantir que ambos sumam juntos.
   *
   * Existe para honrar a regra do prompt de "no máximo 1 a 2 emojis" sem
   * depender só do compromisso do LLM, que ocasionalmente exagera.
   */
  private limitEmojis(text: string, max: number): string {
    if (!text) return text;
    const emojiRegex = /[\p{Extended_Pictographic}](\uFE0F)?/gu;
    let count = 0;
    return text.replace(emojiRegex, (match) => {
      count += 1;
      return count <= max ? match : '';
    });
  }

  private convertListLinesToOptions(lines: string[]): string[] {
    const result: string[] = [];
    let index = 0;

    while (index < lines.length) {
      if (!this.isListLine(lines[index])) {
        result.push(lines[index]);
        index += 1;
        continue;
      }

      const blockItems: string[] = [];
      while (index < lines.length && this.isListLine(lines[index])) {
        const item = this.extractListLineContent(lines[index]);
        if (item) blockItems.push(item);
        index += 1;
      }

      blockItems.forEach((item, idx) => {
        result.push(`${idx + 1} - ${item}`);
      });
    }

    return result;
  }

  private isListLine(line: string): boolean {
    if (!line) return false;
    return /^(?:•\s+|\d{1,2}[).-]\s+)/.test(line);
  }

  private extractListLineContent(line: string): string {
    return line
      .replace(/^•\s+/, '')
      .replace(/^\d{1,2}[).-]\s+/, '')
      .trim();
  }

  private normalizeInboundPhone(rawFrom: string): {
    canonicalPhone: string;
    lookupCandidates: string[];
  } {
    const withoutPrefix = (rawFrom || '').replace(/^whatsapp:/i, '').trim();
    const digits = withoutPrefix.replace(/\D/g, '');

    if (!digits) {
      return {
        canonicalPhone: withoutPrefix,
        lookupCandidates: [withoutPrefix].filter(Boolean),
      };
    }

    const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
    const localWithoutCountry =
      withCountry.startsWith('55') && withCountry.length > 11
        ? withCountry.slice(2)
        : withCountry;

    const canonicalPhone = `+${withCountry}`;
    const formattedCandidates = this.buildPhoneLookupVariants(
      withCountry,
      localWithoutCountry,
    );

    const lookupCandidates = [
      canonicalPhone,
      withCountry,
      localWithoutCountry,
      withoutPrefix,
      ...formattedCandidates,
    ].filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );

    return { canonicalPhone, lookupCandidates };
  }

  private async findUserByPhoneCandidates(
    primaryPhone: string,
    candidates: string[],
  ): Promise<User | null> {
    for (const candidate of candidates) {
      const user = await this.userRepository.findOneByPhone(candidate);
      if (user) return user;
    }

    if (!candidates.includes(primaryPhone)) {
      return this.userRepository.findOneByPhone(primaryPhone);
    }

    return null;
  }

  private normalizeIntentText(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isAudioEnabled(): boolean {
    const raw = this.configService.get<string>('AI_AUDIO_ENABLED', 'true');
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  private async processInboundAudioIfNeeded(data: {
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'other';
      durationSeconds: number | null;
    }>;
    messageSid: string;
  }): Promise<{
    hasAudio: boolean;
    failed: boolean;
    transcription:
      | (Awaited<ReturnType<TranscriptionService['transcribe']>> & {
          downloadedMedia: { url: string; sizeBytes: number };
        })
      | null;
  }> {
    if (!this.isAudioEnabled()) {
      return { hasAudio: false, failed: false, transcription: null };
    }

    const mediaList = data.media || [];
    const audioMedia = mediaList.find((item) => {
      if (item.category === 'audio') return true;
      return this.whatsappMediaService.isAudioMime(item.contentType);
    });

    if (!audioMedia) {
      return { hasAudio: false, failed: false, transcription: null };
    }

    try {
      const downloaded = await this.whatsappMediaService.downloadInboundAudio(
        audioMedia as InboundWhatsappMedia,
      );

      const transcription = await this.transcriptionService.transcribe({
        audioBuffer: downloaded.buffer,
        mimeType: downloaded.mimeType,
        durationSeconds: downloaded.durationSeconds || null,
        fileName: downloaded.fileName,
        language: 'pt',
      });

      this.logger.log(
        `[AI_STT] status=success sid=${data.messageSid} provider=${transcription.provider} bytes=${downloaded.sizeBytes} latencyMs=${transcription.latencyMs} fallback=${Boolean(transcription.fallbackUsed)}`,
      );

      return {
        hasAudio: true,
        failed: false,
        transcription: {
          ...transcription,
          downloadedMedia: {
            url: audioMedia.url,
            sizeBytes: downloaded.sizeBytes,
          },
        },
      };
    } catch (error) {
      const code =
        error instanceof WhatsappMediaValidationError ? error.code : 'UNKNOWN';

      this.logger.warn(
        `[AI_STT] status=failure sid=${data.messageSid} code=${code} message=${error instanceof Error ? error.message : String(error)}`,
      );

      return { hasAudio: true, failed: true, transcription: null };
    }
  }

  private buildUserInputForAi(input: {
    textInput: string;
    transcriptionText: string | null;
  }): string {
    const rawText = (input.textInput || '').trim();
    const transcriptionText = (input.transcriptionText || '').trim();

    if (rawText && transcriptionText) {
      return `${rawText}\n\nTranscrição do áudio: ${transcriptionText}`;
    }

    if (rawText) return rawText;
    if (transcriptionText) return transcriptionText;
    return '';
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

  private isClearContextCommand(normalizedInput: string): boolean {
    if (!normalizedInput) return false;
    if (CLEAR_CONTEXT_EXACT_COMMANDS.has(normalizedInput)) return true;

    return (
      normalizedInput.startsWith('limpar contexto') ||
      normalizedInput.startsWith('limpar conversa') ||
      normalizedInput.startsWith('limpar historico') ||
      normalizedInput.startsWith('limpar chat') ||
      normalizedInput.startsWith('apagar contexto') ||
      normalizedInput.startsWith('apagar historico') ||
      normalizedInput.startsWith('resetar contexto') ||
      normalizedInput.startsWith('resetar conversa')
    );
  }

  private getPendingClearContext(
    phone: string,
  ): PendingClearContextConfirmation | null {
    const pending = this.pendingClearContextByPhone.get(phone);
    if (!pending) return null;

    if (Date.now() > pending.expiresAt) {
      this.pendingClearContextByPhone.delete(phone);
      return null;
    }

    return pending;
  }

  private isConfirmationInput(normalizedInput: string): boolean {
    return (
      normalizedInput === 'sim' ||
      normalizedInput === 'confirmo' ||
      normalizedInput === 'confirmar' ||
      normalizedInput === 'pode limpar' ||
      normalizedInput === 'limpar'
    );
  }

  private isCancelConfirmationInput(normalizedInput: string): boolean {
    return (
      normalizedInput === 'nao' ||
      normalizedInput === 'não' ||
      normalizedInput === 'cancelar' ||
      normalizedInput === 'cancela' ||
      normalizedInput === 'deixa assim' ||
      normalizedInput === 'nao limpar' ||
      normalizedInput === 'não limpar'
    );
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
        `Falha ao enfileirar template interativo de confirmação para ${this.maskPhone(phone)}: ${error?.message || 'erro desconhecido'}`,
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

  private buildPhoneLookupVariants(
    withCountry: string,
    localWithoutCountry: string,
  ): string[] {
    const variants: string[] = [];

    const localDigits = (localWithoutCountry || '').replace(/\D/g, '');
    const localOptions = this.expandBrazilianLocalVariants(localDigits);

    for (const digits of localOptions) {
      if (digits.length === 11) {
        const ddd = digits.slice(0, 2);
        const first = digits.slice(2, 7);
        const last = digits.slice(7);
        variants.push(`(${ddd}) ${first}-${last}`);
        variants.push(`${ddd} ${first}-${last}`);
        variants.push(`${ddd}${first}-${last}`);
      }

      if (digits.length === 10) {
        const ddd = digits.slice(0, 2);
        const first = digits.slice(2, 6);
        const last = digits.slice(6);
        variants.push(`(${ddd}) ${first}-${last}`);
        variants.push(`${ddd} ${first}-${last}`);
        variants.push(`${ddd}${first}-${last}`);
      }

      variants.push(`+55${digits}`);
      variants.push(`55${digits}`);
      variants.push(digits);
    }

    return variants.filter(Boolean);
  }

  private expandBrazilianLocalVariants(localDigits: string): string[] {
    const variants = new Set<string>();
    if (!localDigits) return [];

    variants.add(localDigits);

    // Ex.: 31 8908-5791 -> 31 9 8908-5791
    if (localDigits.length === 10) {
      variants.add(`${localDigits.slice(0, 2)}9${localDigits.slice(2)}`);
    }

    // Ex.: 31 9 8908-5791 -> 31 8908-5791
    if (localDigits.length === 11 && localDigits[2] === '9') {
      variants.add(`${localDigits.slice(0, 2)}${localDigits.slice(3)}`);
    }

    return Array.from(variants);
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
          action: 'update_patient_data',
          minParams: ['surgeryRequestId', 'name|cpf|phone|birthDate'],
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
          action: 'update_date_options',
          minParams: ['surgeryRequestId', 'dateOptions[]'],
        };
      case 'confirm_date':
        return {
          action: 'confirm_date',
          minParams: ['surgeryRequestId', 'selectedDateIndex'],
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
