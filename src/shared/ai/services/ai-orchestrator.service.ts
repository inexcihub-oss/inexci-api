import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { In } from 'typeorm';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { ConversationService } from './conversation.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
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
import { WhatsappDocumentDispatcherService } from './whatsapp-document-dispatcher.service';
import { WhatsappDocumentProcessorService } from './whatsapp-document-processor.service';
import { WHATSAPP_TEMPLATES } from '../../whatsapp/whatsapp-templates.constants';
import { collapseDuplicatedScPrefixes } from '../tools/protocol.helpers';
import { OperationDraftService } from './operation-draft.service';
import { buildToolResult } from '../tools/tool-result';

const MAX_TOOL_ITERATIONS = 5;
const MAX_RESPONSE_LENGTH = 1000;
const WHATSAPP_TARGET_LENGTH = 850;
// Limite "macio" de emojis por resposta para manter o tom amigável sem
// transformar a mensagem em uma parede de figuras. Excedentes são removidos
// silenciosamente preservando o texto.
const MAX_EMOJIS_PER_RESPONSE = 0;
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
 * Tools que seguem o padrão preview/confirmação: chamadas com `confirm: false`
 * mostram apenas a pré-visualização e exigem que o usuário responda "sim"
 * para que a tool seja chamada de novo com `confirm: true`. Quando uma
 * destas tools é executada com `confirm: false`, o orchestrator grava
 * `conversationMemory.pending_confirmation` e, se o próximo turno do
 * usuário for afirmativo, re-executa a tool determinísticamente — sem
 * depender do LLM lembrar do que ele acabou de pedir.
 */
const PREVIEWABLE_MUTATION_TOOLS = new Set<string>([
  'create_hospital',
  'create_health_plan',
  'create_procedure',
  'create_patient',
  'create_surgery_request_from_whatsapp',
  'upload_doctor_signature',
]);

/** Rótulo amigável de cada tool, usado nas mensagens determinísticas. */
const TOOL_DISPLAY_LABELS: Record<string, string> = {
  create_hospital: 'cadastrar o hospital',
  create_health_plan: 'cadastrar o convênio',
  create_procedure: 'cadastrar o procedimento',
  create_patient: 'cadastrar o paciente',
  create_surgery_request_from_whatsapp: 'criar a solicitação cirúrgica',
  upload_doctor_signature: 'atualizar sua assinatura digital',
};

/**
 * Slots OBRIGATÓRIOS para criar uma SC (status Pendente).
 *
 * Conforme o prompt do sistema (regra "CRIAR ≠ ENVIAR"), o mínimo para
 * criar uma SC é: PACIENTE + PROCEDIMENTO (+ prioridade que tem default e
 * + médico que é assumido quando há apenas um acessível).
 *
 * Hospital, convênio, TUSS, OPME e laudo são exigidos APENAS para enviar,
 * portanto NÃO bloqueiam a criação. A própria tool
 * `create_surgery_request_from_whatsapp` já valida internamente e devolve
 * preview/erros guiados quando algo essencial está faltando — o slot-filling
 * aqui serve apenas como segunda linha de defesa.
 */
const REQUIRED_SLOTS_BY_INTENT: Record<string, string[]> = {
  create: ['patient', 'procedure'],
  update: ['surgeryRequest.id'],
  advance: ['surgeryRequest.id'],
};

const SLOT_PROMPTS: Record<string, string> = {
  patient:
    'Antes de criar a solicitação, qual paciente devo usar? Pode me passar o nome (parcial já ajuda) ou o CPF.',
  procedure:
    'Qual o procedimento da cirurgia? Pode me dizer o nome (ex.: "artroscopia de joelho") ou o código.',
  'surgeryRequest.id':
    'Sobre qual solicitação estamos falando? Pode me dizer o protocolo (SC-XXXX) ou o nome do paciente.',
};

/**
 * Aliases por slot — aceita os nomes reais usados pela tool
 * `create_surgery_request_from_whatsapp` (definida em whatsapp-flow.tools.ts).
 * Sem isso, o orchestrator bloqueava SEMPRE a criação por procurar caminhos
 * que a tool nunca recebe (`patient.id`, `surgeryRequest.hospital`, etc.).
 */
const SLOT_ARG_ALIASES: Record<string, string[]> = {
  patient: ['patientId', 'patient_name', 'patient.id'],
  procedure: ['procedureId', 'procedure_name', 'procedure.id'],
};

/**
 * Aliases para o que o orchestrator persiste em `filled_slots` — sempre
 * em chaves "simples" coerentes com `SLOT_ARG_ALIASES`.
 */
const SLOT_PERSIST_KEYS: Record<string, string> = {
  patient: 'patient',
  procedure: 'procedure',
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
  'create_hospital',
  'create_health_plan',
  'create_procedure',
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
  'create_patient_from_document',
]);

/**
 * Tools de mutação que iniciam um fluxo COMPLEXO (múltiplos campos) e
 * portanto exigem `plan_actions` antes — quando `AI_USE_DRAFT_FLOWS=true`.
 * Tools de draft (`*_draft_*`) e tools de mutação simples (avanço/encerramento,
 * confirmar data, set flags) ficam fora — não precisam de pre-planning.
 */
const COMPLEX_MUTATION_TOOL_NAMES = new Set<string>([
  'create_surgery_request_from_whatsapp',
  'create_patient',
  'create_hospital',
  'create_health_plan',
  'create_procedure',
  'invoice_request',
  'contest_authorization_full',
  'contest_payment',
  'update_request_clinical_data',
  'update_request_admin_data',
  'update_patient_data',
  'update_date_options',
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
  private readonly accessibleDoctorsInfoCache = new SimpleCache<
    Array<{ id: string; name?: string | null }>
  >();
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
    private readonly whatsappConversationRepo: WhatsappConversationRepository,
    private readonly operationDraftService: OperationDraftService,
    private readonly documentDispatcher: WhatsappDocumentDispatcherService,
    private readonly documentProcessor: WhatsappDocumentProcessorService,
  ) {}

  private getResponseMaxTokens(): number {
    const value = this.configService.get<number>('AI_RESPONSE_MAX_TOKENS', 450);
    return Math.max(60, Math.floor(Number(value) || 450));
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
   * Grava em `conversationMemory.pending_confirmation` a operação que está
   * aguardando confirmação do usuário (após uma tool de mutação retornar
   * preview com `confirm: false`). No turno seguinte, se o usuário disser
   * "sim", o orchestrator re-executa essa tool com `confirm: true`.
   */
  private async setPendingConfirmation(
    conversationId: string,
    payload: {
      tool: string;
      args: Record<string, unknown>;
      description: string;
    },
  ): Promise<void> {
    await this.writeConversationMemoryPatch(conversationId, {
      pending_confirmation: {
        ...payload,
        createdAt: new Date().toISOString(),
      },
    });
  }

  private async clearPendingConfirmation(
    conversationId: string,
  ): Promise<void> {
    await this.writeConversationMemoryPatch(conversationId, {
      pending_confirmation: null,
    });
  }

  /**
   * Considera o pending_confirmation expirado se mais de 15 minutos
   * passaram. Evita "fantasmas" de confirmações antigas reagirem a um
   * "sim" inocente em uma nova conversa.
   */
  private isPendingConfirmationFresh(createdAt: unknown): boolean {
    if (typeof createdAt !== 'string') return false;
    const ts = Date.parse(createdAt);
    if (Number.isNaN(ts)) return false;
    const MAX_AGE_MS = 15 * 60 * 1000;
    return Date.now() - ts <= MAX_AGE_MS;
  }

  /**
   * Verifica se uma string indica que a tool retornou apenas um preview
   * pedindo confirmação (não executou a mutação). Identificado por chaves
   * estáveis no texto: "Confirme", "Responda \"sim\" para confirmar".
   */
  private looksLikeConfirmationPreview(output: string): boolean {
    if (!output) return false;
    const lower = output.toLowerCase();
    if (lower.includes('responda "sim" para confirmar')) return true;
    if (lower.includes('confirme o cadastro')) return true;
    if (lower.includes('confirme a criação')) return true;
    if (lower.includes('confirme a criacao')) return true;
    return false;
  }

  /**
   * Detecta se uma tool foi executada com sucesso (a mutação aconteceu).
   * Heurística simples mas robusta: a tool retorna "cadastrado com sucesso"
   * / "criada" etc. Ao detectar, limpa pending_confirmation.
   */
  private looksLikeExecutedMutation(output: string): boolean {
    if (!output) return false;
    const lower = output.toLowerCase();
    return (
      lower.includes('cadastrado com sucesso') ||
      lower.includes('cadastrada com sucesso') ||
      lower.includes('criada com sucesso') ||
      lower.includes('criado com sucesso') ||
      lower.includes('atualizado com sucesso') ||
      lower.includes('atualizada com sucesso')
    );
  }

  /**
   * Memoriza entidades em `conversationMemory.filled_slots` e
   * `conversationMemory.surgeryRequest` toda vez que uma tool relevante
   * for chamada. O system prompt do próximo turno injeta esses dados em
   * um bloco "SC EM CONSTRUÇÃO" para o LLM não esquecer e voltar a
   * perguntar a mesma coisa (loop do print 2 / 13:55).
   *
   * Só grava quando a tool foi de fato executada (não apenas preview com
   * `confirm:false`) — caso contrário "polui" a memória com tentativas
   * abortadas. Para tools sem confirmação (ex.: `list_patients`), grava
   * direto a partir dos args quando fizer sentido.
   */
  private async memorizeEntitiesFromToolCall(opts: {
    conversationId: string;
    toolName: string;
    args: Record<string, any>;
    output: string;
  }): Promise<void> {
    const { conversationId, toolName, args, output } = opts;

    // Para tools preview-aware de criação de catálogo (hospital, convênio,
    // procedimento), só memoriza após a execução real (confirm:true +
    // mensagem de sucesso) — antes disso, é só preview e pode ser
    // cancelado.
    //
    // EXCEÇÃO: `create_surgery_request_from_whatsapp` é diferente. Mesmo
    // quando ela falha (ex.: hospital não cadastrado, procedimento não
    // existe), os args do usuário já são uma declaração de intenção que
    // não devem ser perdidos entre turnos (essa era a causa do loop do
    // print 2, em que a IA pedia o procedimento de novo depois de ter
    // sido informado).
    if (
      PREVIEWABLE_MUTATION_TOOLS.has(toolName) &&
      toolName !== 'create_surgery_request_from_whatsapp'
    ) {
      const confirmFlag =
        typeof args.confirm === 'boolean' ? Boolean(args.confirm) : false;
      if (!confirmFlag) return;
      if (!this.looksLikeExecutedMutation(output)) return;
    }

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
      case 'create_patient':
        setIfPresent(filled, 'patient', args.name);
        break;
      case 'create_procedure':
        setIfPresent(filled, 'procedure', args.name);
        break;
      case 'create_hospital':
        setIfPresent(surgeryRequest, 'hospital', args.name);
        break;
      case 'create_health_plan':
        setIfPresent(surgeryRequest, 'healthPlan', args.name);
        break;
      case 'create_surgery_request_from_whatsapp':
        setIfPresent(filled, 'patient', args.patientId || args.patient_name);
        setIfPresent(
          filled,
          'procedure',
          args.procedureId || args.procedure_name,
        );
        if (args.priority !== undefined && args.priority !== null) {
          setIfPresent(filled, 'priority', String(args.priority));
        }
        setIfPresent(
          surgeryRequest,
          'hospital',
          args.hospitalId || args.hospital_name,
        );
        setIfPresent(
          surgeryRequest,
          'healthPlan',
          args.healthPlanId || args.health_plan_name,
        );
        setIfPresent(surgeryRequest, 'doctorId', args.doctorId);
        break;
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
   * Após a execução de cada tool, decide se grava/limpa o pending_confirmation
   * no conversation_memory. Chamado dentro do loop de toolResults.
   *
   * - Se a tool é de mutação preview-aware e retornou preview → grava.
   * - Se a tool é de mutação preview-aware e EXECUTOU (confirm:true ou
   *   resultado de sucesso) → limpa.
   * - Se a tool é qualquer outra (não-preview) → não mexe.
   */
  private async trackPendingConfirmation(opts: {
    conversationId: string;
    toolName: string;
    args: Record<string, unknown>;
    output: string;
  }): Promise<void> {
    const { conversationId, toolName, args, output } = opts;
    if (!PREVIEWABLE_MUTATION_TOOLS.has(toolName)) return;

    const confirmFlag =
      typeof (args as any).confirm === 'boolean'
        ? Boolean((args as any).confirm)
        : false;

    if (this.looksLikeExecutedMutation(output)) {
      await this.clearPendingConfirmation(conversationId);
      return;
    }

    if (!confirmFlag && this.looksLikeConfirmationPreview(output)) {
      const description =
        TOOL_DISPLAY_LABELS[toolName] || `executar ${toolName}`;
      await this.setPendingConfirmation(conversationId, {
        tool: toolName,
        args: { ...args, confirm: true },
        description,
      });
      this.logger.log(
        `[PENDING_CONFIRMATION] saved conv=${conversationId} tool=${toolName}`,
      );
    }
  }

  /**
   * Constrói um hint imperativo quando há pending_confirmation fresco e o
   * usuário respondeu com confirmação ("sim", "ok", etc.). O hint força o
   * LLM a chamar a tool indicada exatamente com os args salvos +
   * `confirm: true`, evitando o velho "não ficou claro o que confirmou".
   *
   * Se o usuário negou explicitamente (não/cancela/esquece), retorna hint
   * de cancelamento e limpa o estado.
   */
  private async buildPendingConfirmationHint(
    conversationId: string,
    rawInput: string,
  ): Promise<string | null> {
    if (!rawInput?.trim()) return null;
    const isAffirmative = this.parseAffirmativeConfirmation(rawInput);
    const isNegative =
      !isAffirmative && this.parseNegativeConfirmation(rawInput);
    if (!isAffirmative && !isNegative) return null;

    const memory = await this.readConversationMemory(conversationId);
    const pending = memory?.pending_confirmation as
      | {
          tool: string;
          args: Record<string, unknown>;
          description?: string;
          createdAt?: string;
        }
      | null
      | undefined;
    if (!pending || !pending.tool) return null;
    if (!this.isPendingConfirmationFresh(pending.createdAt)) {
      await this.clearPendingConfirmation(conversationId);
      return null;
    }

    if (isNegative) {
      await this.clearPendingConfirmation(conversationId);
      const description = pending.description || `executar ${pending.tool}`;
      return [
        'CANCELAMENTO DETERMINÍSTICO:',
        `- O usuário disse "não" em resposta ao seu pedido de confirmação para ${description}.`,
        '- NÃO chame a tool agora. Responda confirmando o cancelamento em uma frase curta e pergunte como prefere prosseguir.',
      ].join('\n');
    }

    // Serializa args para o hint de forma curta e segura.
    const safeArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pending.args || {})) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'object') {
        try {
          safeArgs[k] = JSON.parse(JSON.stringify(v));
        } catch {
          safeArgs[k] = String(v);
        }
        continue;
      }
      safeArgs[k] = v;
    }
    safeArgs.confirm = true;

    const argsJson = JSON.stringify(safeArgs);
    const description = pending.description || `executar ${pending.tool}`;
    return [
      'CONFIRMAÇÃO DETERMINÍSTICA:',
      `- No turno anterior, você pediu ao usuário para confirmar uma operação (${description}).`,
      `- O usuário respondeu afirmativamente ("${rawInput.trim()}").`,
      `- AÇÃO OBRIGATÓRIA AGORA: chame IMEDIATAMENTE a tool \`${pending.tool}\` com EXATAMENTE estes argumentos:`,
      `\`\`\`json\n${argsJson}\n\`\`\``,
      '- NÃO peça mais dados, NÃO repita a mesma pergunta, NÃO responda "não ficou claro o que confirmou".',
      '- Após a tool executar, apenas confirme o resultado em uma frase curta e ofereça o próximo passo natural (ex.: continuar a SC).',
    ].join('\n');
  }

  /**
   * Detecta entradas de confirmação afirmativa ("sim", "confirmo", "ok",
   * "pode mandar", etc.). Usado em conjunto com `conversationMemory.pending_confirmation`
   * para re-executar uma tool de mutação determinada sem depender do LLM
   * lembrar do contexto.
   */
  private parseAffirmativeConfirmation(rawInput: string): boolean {
    if (!rawInput) return false;
    const normalized = rawInput
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!normalized) return false;
    if (normalized.length > 60) return false;
    const phrases = new Set<string>([
      'sim',
      's',
      'sim!',
      'sim por favor',
      'sim, por favor',
      'sim por favor.',
      'sim claro',
      'sim, claro',
      'claro',
      'claro!',
      'pode',
      'pode sim',
      'pode mandar',
      'pode mandar ver',
      'manda',
      'manda ver',
      'manda bala',
      'mandar',
      'segue',
      'segue ai',
      'segue aí',
      'vai',
      'vai la',
      'vai lá',
      'vamos',
      'vamos la',
      'vamos lá',
      'confirmo',
      'confirmado',
      'confirma',
      'confirmar',
      'ok',
      'okay',
      'beleza',
      'blz',
      'show',
      'isso',
      'isso mesmo',
      'isso ai',
      'isso aí',
      'positivo',
      'afirmativo',
      'quero',
      'quero sim',
      'quero sim por favor',
      'aceito',
      'aceitar',
      'fechado',
      'feito',
      'bora',
      'bora la',
      'bora lá',
      'pode prosseguir',
      'prosseguir',
      'prossiga',
      'prossiga por favor',
    ]);
    return phrases.has(normalized);
  }

  /**
   * Detecta cancelamento / negativa explícita ("não", "cancela", "pare").
   */
  private parseNegativeConfirmation(rawInput: string): boolean {
    if (!rawInput) return false;
    const normalized = rawInput
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!normalized) return false;
    if (normalized.length > 60) return false;
    return new Set<string>([
      'nao',
      'n',
      'nao, obrigado',
      'nao obrigado',
      'nao quero',
      'cancela',
      'cancelar',
      'cancele',
      'pare',
      'para',
      'desiste',
      'desistir',
      'esquece',
      'esquecer',
      'deixa',
      'deixa pra la',
      'deixa pra lá',
      'nada',
      'nada nao',
    ]).has(normalized);
  }

  /**
   * Detecta se a mensagem do usuário é uma escolha numérica curta e direta
   * referente à lista de "Próximos passos" enviada no turno anterior.
   *
   * Aceita:
   *   - "1", "2", ..., "9" (apenas o dígito)
   *   - "opção 2", "opcao 2", "a 3", "na 2", "quero a 1", "vai na 2"…
   *   - Variantes por extenso curtas: "um", "dois", "três"
   *
   * Retorna o dígito (1-9) ou `null`.
   */
  private parseNumericChoice(rawInput: string): number | null {
    if (!rawInput) return null;
    const normalized = rawInput
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!normalized) return null;
    if (normalized.length > 30) return null;

    const wordToDigit: Record<string, number> = {
      um: 1,
      uma: 1,
      dois: 2,
      duas: 2,
      tres: 3,
    };
    if (wordToDigit[normalized] !== undefined) return wordToDigit[normalized];

    const patterns: RegExp[] = [
      /^([1-9])$/,
      /^op[cs]ao\s*([1-9])$/,
      /^opcao\s+([1-9])$/,
      /^(?:a|na|o|no)\s+([1-9])$/,
      /^quero\s+(?:a\s+)?([1-9])$/,
      /^vai\s+(?:na?\s+)?([1-9])$/,
      /^escolho\s+(?:a\s+)?([1-9])$/,
      /^seleciono\s+(?:a\s+)?([1-9])$/,
      /^(?:e\s+)?(?:a|o)\s+([1-9])$/,
    ];
    for (const re of patterns) {
      const m = normalized.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  }

  /**
   * Extrai um mapa `{digito -> texto da opção}` a partir de um texto livre
   * (geralmente a última mensagem do assistente). Olha linhas no formato
   * "1 - texto", "1) texto", "1. texto", "1 — texto", etc.
   */
  private extractNumberedOptionsFromText(text: string): Record<number, string> {
    const out: Record<number, string> = {};
    if (!text) return out;
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const m = line.match(/^\s*([1-9])\s*[-–—).]\s+(.+?)\s*$/);
      if (!m) continue;
      const digit = Number(m[1]);
      if (!out[digit]) out[digit] = m[2].trim();
    }
    return out;
  }

  /**
   * Quando o usuário responde apenas com um dígito (ou variação curta) e a
   * última mensagem do assistente terminou com uma lista numerada, monta um
   * bloco system determinístico instruindo o LLM a executar a opção
   * escolhida (sem voltar a perguntar "qual ação você quer?"). Sem isso o
   * modelo ainda às vezes ignora a regra do prompt e devolve o famigerado
   * "Parece que você escolheu a opção X, mas não ficou claro..." — sintoma
   * exato do print reportado pelo usuário em 2026-05-11.
   *
   * Retorna `null` quando não há nada a injetar (input não é numérico,
   * última mensagem não tem opções, etc.).
   */
  private async buildNumericChoiceHint(
    conversationId: string,
    rawInput: string,
  ): Promise<string | null> {
    const digit = this.parseNumericChoice(rawInput);
    if (!digit) return null;
    try {
      // Janela curta — precisamos só da última mensagem do assistente.
      const recent = await this.conversationService.loadRecentForLlm(
        conversationId,
        6,
      );
      let lastAssistant: string | null = null;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].role === 'assistant') {
          lastAssistant = recent[i].content;
          break;
        }
      }
      if (!lastAssistant) return null;
      const options = this.extractNumberedOptionsFromText(lastAssistant);
      const optionKeys = Object.keys(options).map((k) => Number(k));
      if (!optionKeys.length) return null;

      const chosenText = options[digit];
      if (!chosenText) {
        return [
          'INTERPRETAÇÃO DETERMINÍSTICA DE RESPOSTA NUMÉRICA:',
          `- O usuário respondeu "${rawInput.trim()}", mas a última lista de Próximos passos só ofereceu as opções ${optionKeys.join('/')}.`,
          '- Peça desculpa em UMA frase e mostre as opções novamente.',
          '- NÃO responda "não ficou claro qual ação".',
        ].join('\n');
      }

      return [
        'INTERPRETAÇÃO DETERMINÍSTICA DE RESPOSTA NUMÉRICA (OBRIGATÓRIO SEGUIR):',
        `- A última mensagem que você enviou terminou com uma lista de "Próximos passos" numerada.`,
        `- O usuário respondeu "${rawInput.trim()}", o que significa que ele escolheu a OPÇÃO ${digit}: "${chosenText}".`,
        '- AGORA EXECUTE essa opção, sem voltar a perguntar qual ação ele quer:',
        '  • Se a opção requer um dado adicional (ex.: protocolo da SC), faça APENAS UMA pergunta curta e objetiva pedindo SÓ esse dado.',
        '  • Se você pode executá-la direto (chamando uma tool), execute imediatamente.',
        '- PROIBIDO responder "não ficou claro qual ação", "não entendi", "pode me explicar melhor" ou variações. A escolha JÁ está clara.',
      ].join('\n');
    } catch (err) {
      this.logger.debug(
        `[NUMERIC_CHOICE] hint_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
      return null;
    }
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
   * Slot-filling: se o LLM estiver tentando criar uma SC com algum slot
   * obrigatório ainda ausente, intercepta a chamada e devolve a próxima
   * pergunta determinística ao usuário (uma por vez). Slots já confirmados
   * em `conversationMemory.filled_slots` não são re-perguntados.
   */
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

    const slotHasValue = (slot: string): boolean => {
      // Considera preenchido se a memória da conversa já registrou esse slot
      // (turnos anteriores) OU se a chamada atual trouxe qualquer um dos
      // aliases conhecidos da tool (`patientId` ou `patient_name`, etc.).
      if (filled[slot]) return true;
      if (filled[`${slot}.id`]) return true;
      const aliases = SLOT_ARG_ALIASES[slot] || [slot];
      return aliases.some((alias) => argsHasPath(alias));
    };

    for (const slot of required) {
      if (!slotHasValue(slot)) {
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

      const recordSlot = (slotKey: string, value: unknown): void => {
        if (value == null) return;
        if (typeof value === 'string' && !value.trim()) return;
        const key = SLOT_PERSIST_KEYS[slotKey] || slotKey;
        filled[key] = String(value);
      };

      // Aliases reais da tool `create_surgery_request_from_whatsapp`.
      recordSlot('patient', args?.patientId);
      if (!filled['patient']) recordSlot('patient', args?.patient_name);
      if (!filled['patient']) recordSlot('patient', args?.patient?.id);

      recordSlot('procedure', args?.procedureId);
      if (!filled['procedure']) recordSlot('procedure', args?.procedure_name);
      if (!filled['procedure']) recordSlot('procedure', args?.procedure?.id);

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
    return this.piiVault.preprocessUserInput(conversationId, rawInput);
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
      category: 'audio' | 'image' | 'pdf' | 'other';
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
      category: 'audio' | 'image' | 'pdf' | 'other';
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
        'Você enviou mensagens em ritmo muito alto. Por favor, aguarde alguns instantes antes de tentar novamente.',
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

      const documentHandled = await this.processInboundDocumentIfNeeded({
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
        const failureMessage = this.buildAudioFailureUserMessage(
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

      const accessibleDoctorsInfo =
        await this.resolveAccessibleDoctorsInfo(accessibleDoctorIds);

      const built = await this.contextService.buildContext({
        conversation: updatedConv,
        ragContext: ragContext || null,
        userInfo: {
          id: userId,
          name: user?.name ?? null,
          role: user?.role ?? null,
          isDoctor: Boolean(user?.doctorProfile?.id) || Boolean(user?.isDoctor),
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
      const numericHint = await this.buildNumericChoiceHint(
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
      const confirmationHint = await this.buildPendingConfirmationHint(
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
        ownerId,
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

        // Plan-first guard: bloqueia tools de mutação complexa quando o LLM
        // não chamou `plan_actions` neste turno e ainda não há `operation_draft`.
        // Devolve resultado estruturado de `blocked` para que o LLM se corrija
        // e chame `plan_actions` na próxima iteração.
        const blockedToolCallIds = await this.evaluatePlanFirstGuard(
          responseMessage.tool_calls,
          conversation.id,
        );

        const toolCallsToExecute = blockedToolCallIds.size
          ? responseMessage.tool_calls.filter(
              (call) => !blockedToolCallIds.has(call.id),
            )
          : responseMessage.tool_calls;

        const toolResults = toolCallsToExecute.length
          ? await this.toolExecutor.executeMany(toolCallsToExecute, toolContext)
          : [];

        if (blockedToolCallIds.size) {
          for (const call of responseMessage.tool_calls) {
            if (!blockedToolCallIds.has(call.id)) continue;
            toolResults.push({
              toolCallId: call.id,
              output: buildToolResult({
                status: 'blocked',
                message:
                  'Antes de chamar tools de mutação complexa, chame `plan_actions` para classificar a intenção e abrir o rascunho correspondente.',
                errors: [
                  {
                    code: 'PLAN_ACTIONS_REQUIRED',
                    message:
                      'Chame `plan_actions` primeiro neste turno para inicializar o rascunho.',
                  },
                ],
              }),
            });
          }
        }

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

            // Gerencia o pending_confirmation no conversation_memory para que
            // o próximo turno consiga re-executar a tool sem depender do LLM
            // lembrar do contexto.
            await this.trackPendingConfirmation({
              conversationId: conversation.id,
              toolName: functionName,
              args,
              output: result.output,
            });

            // Memoriza entidades extraídas dos args quando a tool foi
            // efetivamente executada (não apenas preview). Garante que
            // procedimento/paciente/hospital/convênio mencionados em turnos
            // anteriores fiquem visíveis no system prompt do próximo turno.
            await this.memorizeEntitiesFromToolCall({
              conversationId: conversation.id,
              toolName: functionName,
              args,
              output: result.output,
            });

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
              'Reescreva a resposta para WhatsApp em português do Brasil, mantendo apenas os fatos já presentes. Não adicione informações novas. Use tom gentil, acolhedor e profissional, com linguagem direta e frases curtas. NUNCA use emojis (nem ✅, 📅, 📋, ⚠️, 👋 — qualquer figura está proibida); o tom acolhedor deve vir do texto. Se a resposta bruta tiver emojis, REMOVA todos. Quando fizer sentido, encerre sugerindo de 2 a 4 próximos passos como opções numeradas no formato "1 - opção", uma por linha. Mire em até 8 linhas, sem markdown avançado e sem JSON.',
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
    const cleanedEmojiText = this.cleanEmojiArtifacts(limitedEmojiText);
    const normalizedLines = cleanedEmojiText
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
   * Hoje a política é "ZERO emojis" (`MAX_EMOJIS_PER_RESPONSE = 0`), então
   * a função efetivamente remove qualquer emoji que o LLM produza. Mantemos
   * o nome `limitEmojis` para preservar a possibilidade de reativar um teto
   * pequeno no futuro sem mudar a arquitetura.
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

  /**
   * Limpa artefatos deixados pela remoção de emojis: espaços duplicados,
   * espaços antes de pontuação e linhas que ficaram vazias. Sem isso, frases
   * como "Pronto ✅ tudo certo." viravam "Pronto  tudo certo." após
   * `limitEmojis(0)`, o que parecia um erro de formatação.
   */
  private cleanEmojiArtifacts(text: string): string {
    if (!text) return text;
    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/(^|\n)[ \t]+/g, '$1');
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

  /**
   * Pipeline de documentos inbound (Sprint 1 — apenas intent gate).
   *
   * - Mídia nova (image/pdf): faz staging no Supabase tmp, salva pendência
   *   por telefone e envia mensagem de texto pedindo a intent (1/2/3).
   *   Retorna `true` para encerrar o turno antes de chamar o LLM.
   * - Pendência ativa + resposta "cancelar": apaga staging + pendência.
   * - Pendência ativa + resposta 1/2/3: por enquanto, responde que o
   *   processamento (OCR/criação) ainda não está disponível e mantém a
   *   pendência ativa para o Sprint 3 finalizar.
   *
   * Para qualquer outro caso retorna `false` (deixa o fluxo principal
   * seguir normalmente).
   */
  private async processInboundDocumentIfNeeded(opts: {
    phone: string;
    body: string;
    normalizedInput: string;
    messageSid: string;
    userId: string;
    ownerId?: string | null;
    conversationId?: string;
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'image' | 'pdf' | 'other';
      durationSeconds: number | null;
    }>;
  }): Promise<boolean> {
    if (!this.documentDispatcher.isEnabled()) {
      return false;
    }

    // 1) Tem mídia inbound de documento? Faz staging + intent prompt.
    const incomingDocMedia = this.documentDispatcher.pickDocumentMedia(
      opts.media as any,
    );
    if (incomingDocMedia) {
      const existingPending = await this.documentDispatcher.getPending(
        opts.phone,
      );
      if (existingPending) {
        await this.documentDispatcher.deleteStoragePath(
          existingPending.storagePath,
        );
        await this.documentDispatcher.clearPending(opts.phone);
      }

      const outcome = await this.documentDispatcher.stageInboundDocument({
        media: incomingDocMedia,
        phone: opts.phone,
        messageSid: opts.messageSid,
      });

      if (outcome.status === 'failed') {
        await this.whatsappService.sendMessage(
          opts.phone,
          this.documentDispatcher.buildDownloadFailureMessage(
            outcome.failureReason || 'UNKNOWN',
          ),
        );
        return true;
      }

      if (outcome.status === 'staged') {
        await this.whatsappService.sendMessage(
          opts.phone,
          this.documentDispatcher.buildIntentPromptMessage(),
        );
        return true;
      }

      return false;
    }

    // 2) Não tem mídia nova — verifica se há pendência ativa de turno
    //    anterior e se a mensagem é uma intent reconhecida.
    const pending = await this.documentDispatcher.getPending(opts.phone);
    if (!pending) return false;

    const intent = this.documentDispatcher.parseIntent(opts.body);
    if (!intent) {
      // Usuário não respondeu a intent — não bloqueia o fluxo. Pendência
      // permanece ativa até expirar pelo TTL (cron limpa o tmp).
      return false;
    }

    if (intent === 'cancel') {
      await this.documentDispatcher.deleteStoragePath(pending.storagePath);
      await this.documentDispatcher.clearPending(opts.phone);
      this.logger.log(
        `[AI_DOC_INTENT] sid=${opts.messageSid} phone=${this.maskPhone(opts.phone)} intent=cancel`,
      );
      await this.whatsappService.sendMessage(
        opts.phone,
        'Tudo bem, descartei o arquivo enviado. Se quiser, é só mandar de novo quando precisar.',
      );
      return true;
    }

    this.logger.log(
      `[AI_DOC_INTENT] sid=${opts.messageSid} phone=${this.maskPhone(opts.phone)} intent=${intent}`,
    );

    // Sprint 3 — intent reconhecida: roda OCR + classifier e responde com
    // resumo do que foi encontrado + pergunta apropriada. As tools
    // `attach_document_from_whatsapp` / `create_patient_from_document` /
    // sc_draft_* serão chamadas nos próximos turnos via LLM.
    void opts.userId;

    // Reuso da classificação se já foi feita anteriormente para a mesma
    // pendência (caso o usuário responda outra coisa entre o intent prompt
    // e a confirmação final). Evita custo desnecessário de OpenAI.
    if (
      pending.classification &&
      pending.intent === intent &&
      pending.classifiedAt &&
      Date.now() - pending.classifiedAt < 5 * 60 * 1000
    ) {
      const cachedSummary = this.buildDocumentReminderMessage(intent, pending);
      await this.whatsappService.sendMessage(opts.phone, cachedSummary);
      return true;
    }

    const outcome = await this.documentProcessor.processPendingDocument({
      phone: opts.phone,
      pending,
      intent,
      conversationId: opts.conversationId ?? opts.phone,
      messageSid: opts.messageSid,
      userId: opts.userId,
      ownerId: opts.ownerId ?? null,
    });

    if (outcome.status !== 'ok' || !outcome.userSummary) {
      await this.whatsappService.sendMessage(
        opts.phone,
        outcome.errorMessage ||
          'Não consegui processar o arquivo agora. Tente reenviar em alguns instantes.',
      );
      return true;
    }

    await this.whatsappService.sendMessage(opts.phone, outcome.userSummary);
    return true;
  }

  /**
   * Quando o usuário responde a intent uma segunda vez (ex.: clicou "1" de
   * novo) sem mudar de assunto, devolvemos um resumo encurtado da
   * classificação já feita, sem chamar OCR/LLM novamente.
   */
  private buildDocumentReminderMessage(
    intent: 'attach' | 'create_sc' | 'create_patient',
    pending: any,
  ): string {
    const classification = pending.classification;
    const kindLabel = classification?.kind ?? 'documento';
    const lines: string[] = [
      `Já analisei o documento (${kindLabel}). O que devo fazer agora?`,
    ];
    switch (intent) {
      case 'attach':
        lines.push(
          'Me diga o protocolo da SC (ex.: SC-1234) onde anexar, ou peça para listar suas SCs ativas.',
        );
        break;
      case 'create_sc':
        lines.push(
          'Responda "sim" para iniciar o rascunho da nova SC com os dados extraídos.',
        );
        break;
      case 'create_patient':
        lines.push(
          'Responda "sim" para confirmar o cadastro do paciente com os dados extraídos.',
        );
        break;
    }
    return lines.join('\n');
  }

  private async processInboundAudioIfNeeded(data: {
    media?: Array<{
      url: string;
      contentType: string | null;
      category: 'audio' | 'image' | 'pdf' | 'other';
      durationSeconds: number | null;
    }>;
    messageSid: string;
  }): Promise<{
    hasAudio: boolean;
    failed: boolean;
    failureReason?:
      | 'AUDIO_NOT_ALLOWED'
      | 'AUDIO_TOO_LARGE'
      | 'AUDIO_TOO_LONG'
      | 'MEDIA_URL_INVALID'
      | 'STT_PROVIDER_UNREACHABLE'
      | 'STT_PROVIDER_ERROR'
      | 'STT_EMPTY_TRANSCRIPTION'
      | 'UNKNOWN';
    failureMessage?: string;
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
      const errMessage = error instanceof Error ? error.message : String(error);

      // Classifica a causa raiz para que a resposta ao usuário seja útil
      // (e o log mostre exatamente o que falhou — antes só aparecia "UNKNOWN").
      let reason:
        | 'AUDIO_NOT_ALLOWED'
        | 'AUDIO_TOO_LARGE'
        | 'AUDIO_TOO_LONG'
        | 'MEDIA_URL_INVALID'
        | 'STT_PROVIDER_UNREACHABLE'
        | 'STT_PROVIDER_ERROR'
        | 'STT_EMPTY_TRANSCRIPTION'
        | 'UNKNOWN' = 'UNKNOWN';

      if (error instanceof WhatsappMediaValidationError) {
        // Erros DOC_* não chegam aqui (esse caminho é só áudio), mas a
        // união do tipo precisa do narrowing.
        if (
          error.code === 'AUDIO_NOT_ALLOWED' ||
          error.code === 'AUDIO_TOO_LARGE' ||
          error.code === 'AUDIO_TOO_LONG' ||
          error.code === 'MEDIA_URL_INVALID'
        ) {
          reason = error.code;
        }
      } else if (/transcrição vazia/i.test(errMessage)) {
        reason = 'STT_EMPTY_TRANSCRIPTION';
      } else if (
        /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|aborted|ETIMEDOUT|UND_ERR_CONNECT/i.test(
          errMessage,
        )
      ) {
        reason = 'STT_PROVIDER_UNREACHABLE';
      } else if (
        /faster-whisper retornou status|openai-whisper retornou status|status 4\d\d|status 5\d\d/i.test(
          errMessage,
        )
      ) {
        reason = 'STT_PROVIDER_ERROR';
      }

      this.logger.warn(
        `[AI_STT] status=failure sid=${data.messageSid} reason=${reason} message=${errMessage}`,
      );

      return {
        hasAudio: true,
        failed: true,
        failureReason: reason,
        failureMessage: errMessage,
        transcription: null,
      };
    }
  }

  /**
   * Mapeia o motivo da falha do STT para uma resposta amigável e
   * acionável ao usuário, em vez do genérico "não consegui transcrever".
   */
  private buildAudioFailureUserMessage(reason: string | undefined): string {
    switch (reason) {
      case 'AUDIO_NOT_ALLOWED':
        return 'O formato deste áudio não é suportado. Tente regravar o áudio diretamente pelo WhatsApp (que envia em formato compatível) ou digite a mensagem.';
      case 'AUDIO_TOO_LARGE':
        return 'Esse áudio é muito grande. Tente gravar um áudio mais curto (até ~5 minutos) ou digite a mensagem.';
      case 'AUDIO_TOO_LONG':
        return 'Esse áudio é muito longo. O limite é de 5 minutos. Pode quebrar em áudios menores ou digitar a mensagem.';
      case 'STT_PROVIDER_UNREACHABLE':
        return 'O serviço de transcrição está temporariamente indisponível. Pode digitar a mensagem que sigo daqui — assim que o serviço voltar, áudios funcionam de novo.';
      case 'STT_PROVIDER_ERROR':
        return 'O serviço de transcrição respondeu com um erro. Pode tentar novamente em alguns minutos ou, se preferir, digite a mensagem.';
      case 'STT_EMPTY_TRANSCRIPTION':
        return 'Recebi seu áudio mas não consegui identificar nenhum trecho de fala. Pode tentar gravar de novo (mais perto do microfone, sem ruído) ou digitar a mensagem?';
      case 'MEDIA_URL_INVALID':
        return 'Não consegui baixar o áudio enviado. Pode tentar de novo ou digitar a mensagem.';
      default:
        return 'Não consegui transcrever seu áudio desta vez. Pode tentar novamente enviando outro áudio mais curto ou, se preferir, digitar a mensagem.';
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
