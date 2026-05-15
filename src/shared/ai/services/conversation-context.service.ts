import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from './openai.service';
import { PiiVaultService } from './pii-vault.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';
import {
  WhatsappConversation,
  ConversationMemory,
} from '../../../database/entities/whatsapp-conversation.entity';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';
import { mergeConversationMemory } from '../memory/conversation-memory-merger';

const SUMMARY_FAILURE_LIMIT = 3;

/**
 * Estratégia efetivamente aplicada na montagem do contexto.
 *
 * - `hybrid`: caminho normal — system + summary + memory + RAG + janela curta.
 * - `history_only`: estado degradado quando o circuit breaker disparou
 *   (>= 3 falhas consecutivas do sumarizador na mesma conversa). Apenas
 *   `system + RAG + janela curta` são enviados; summary/memory são ignorados
 *   até a próxima sumarização bem-sucedida.
 */
export type ContextStrategy = 'history_only' | 'hybrid';

export interface ContextBlockBreakdown {
  system_tokens: number;
  summary_tokens: number;
  memory_tokens: number;
  recent_tokens: number;
  rag_tokens: number;
  totalTokens: number;
}

export interface BuildContextResult {
  messages: OpenAI.ChatCompletionMessageParam[];
  breakdown: ContextBlockBreakdown;
  strategy: ContextStrategy;
  recentCount: number;
}

export interface UserContextInfo {
  id: string;
  name?: string | null;
  role?: string | null;
  isDoctor?: boolean;
  ownerId?: string | null;
  /**
   * Lista resumida de médicos acessíveis ao usuário (id + nome). Permite
   * que a IA cite o médico correto quando o usuário pedir "criar SC para
   * o Dr. Fulano" sem precisar consultar a base.
   */
  accessibleDoctors?: Array<{ id: string; name?: string | null }>;
}

export interface BuildContextOptions {
  conversation: WhatsappConversation;
  ragContext?: string | null;
  systemPromptBase?: string;
  /** Override do número de mensagens recentes (default = AI_MAX_RECENT_MESSAGES). */
  recentLimit?: number;
  /** Dados do usuário atual injetados como bloco no system. */
  userInfo?: UserContextInfo | null;
}

/**
 * Estima tokens via heurística simples (text.length / 4). Suficiente para
 * decisões de orçamento; não tenta ser exata como tiktoken.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

@Injectable()
export class ConversationContextService {
  private readonly logger = new Logger(ConversationContextService.name);

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly conversationRepo: WhatsappConversationRepository,
    private readonly messageRepo: WhatsappConversationMessageRepository,
    private readonly piiVault: PiiVaultService,
    private readonly configService: ConfigService,
  ) {}

  private getMaxRecent(): number {
    const value = this.configService.get<number>('AI_MAX_RECENT_MESSAGES', 10);
    return Math.max(1, Math.floor(Number(value) || 10));
  }

  private getTokenBudget(): number {
    const value = this.configService.get<number>(
      'AI_CONTEXT_TOKEN_BUDGET',
      2200,
    );
    return Math.max(500, Math.floor(Number(value) || 2200));
  }

  private getSummaryTriggerEvery(): number {
    const value = this.configService.get<number>(
      'AI_SUMMARY_TRIGGER_EVERY_MESSAGES',
      5,
    );
    return Math.max(2, Math.floor(Number(value) || 5));
  }

  private getSummaryMaxTokens(): number {
    const value = this.configService.get<number>('AI_SUMMARY_MAX_TOKENS', 450);
    return Math.max(100, Math.floor(Number(value) || 450));
  }

  /**
   * Monta a lista final de mensagens para o LLM:
   *   `system + summary + memory + RAG + janela curta`
   * respeitando `AI_CONTEXT_TOKEN_BUDGET` (corta na ordem rag → recent → summary).
   *
   * Circuit breaker: se o sumarizador acumulou >= SUMMARY_FAILURE_LIMIT falhas
   * consecutivas neste `conversationId`, summary/memory são ignorados até a
   * próxima sumarização bem-sucedida (estratégia retornada como `history_only`).
   */

  /**
   * Constrói um bloco system curto e imperativo com as entidades que o
   * usuário já forneceu para a SC em construção (paciente, procedimento,
   * hospital, convênio, prioridade). Esse bloco é incluído em TODOS os
   * turnos, mesmo no modo `history_only`, para evitar que o LLM esqueça
   * informações dadas em turnos anteriores e fique repetindo perguntas.
   */
  private buildSurgeryRequestBuildingBlock(
    memory: Record<string, unknown> | null | undefined,
  ): string | null {
    if (!memory) return null;
    const filled = (memory as any).filled_slots as
      | Record<string, unknown>
      | undefined;
    const sr = (memory as any).surgeryRequest as
      | Record<string, unknown>
      | undefined;

    const items: string[] = [];
    const pushIfPresent = (label: string, value: unknown) => {
      if (value === null || value === undefined) return;
      const text = String(value).trim();
      if (!text) return;
      items.push(`- ${label}: ${text}`);
    };

    if (filled) {
      pushIfPresent('Paciente', filled.patient);
      pushIfPresent('Procedimento cirúrgico', filled.procedure);
      pushIfPresent('Prioridade', filled.priority);
    }
    if (sr) {
      pushIfPresent('Hospital', sr.hospital);
      pushIfPresent('Convênio', sr.healthPlan);
      pushIfPresent('Médico responsável (doctorId)', sr.doctorId);
      if (sr.id) items.push(`- SC já criada (id): ${String(sr.id)}`);
    }
    if (!items.length) return null;

    return [
      'SC EM CONSTRUÇÃO — DADOS JÁ FORNECIDOS PELO USUÁRIO (NÃO PEÇA DE NOVO):',
      ...items,
      'Antes de perguntar qualquer um destes dados, verifique aqui. Se já estiver listado, NÃO peça de novo: use o valor existente. Pergunte apenas o que AINDA não está nesta lista.',
    ].join('\n');
  }

  async buildContext(
    options: BuildContextOptions,
  ): Promise<BuildContextResult> {
    const { conversation, ragContext } = options;
    const failures = conversation.conversationMemory?.summary_failures ?? 0;
    const degraded = failures >= SUMMARY_FAILURE_LIMIT;
    const strategy: ContextStrategy = degraded ? 'history_only' : 'hybrid';
    if (degraded) {
      this.logger.warn(
        `[CONTEXT_SUMMARY] conv=${conversation.id} circuit_breaker_open failures=${failures}`,
      );
    }
    const maxRecent = options.recentLimit ?? this.getMaxRecent();
    const budget = this.getTokenBudget();
    const systemBase = options.systemPromptBase ?? SYSTEM_PROMPT;

    const recentRows = await this.messageRepo.findRecentByConversation(
      conversation.id,
      maxRecent,
    );
    const recent = this.trimRecentMessages(
      recentRows.map((r) => ({ role: r.role, content: r.content })),
      maxRecent,
    );

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    const breakdown: ContextBlockBreakdown = {
      system_tokens: 0,
      summary_tokens: 0,
      memory_tokens: 0,
      recent_tokens: 0,
      rag_tokens: 0,
      totalTokens: 0,
    };

    messages.push({ role: 'system', content: systemBase });
    breakdown.system_tokens = estimateTokens(systemBase);

    if (conversation.userId) {
      // Tokeniza o telefone do usuário (LGPD/T0.7): preserva o número como
      // placeholder para a IA usar (em vez de ser redigido por máscara
      // genérica pelo `redactResidualPii`).
      const phoneToken = conversation.phone
        ? this.piiVault.tokenize(conversation.id, conversation.phone, 'phone')
        : '';

      const info = options.userInfo;
      const lines: string[] = [
        'USUÁRIO ATUAL (use estes dados — NÃO peça de novo):',
      ];
      lines.push(`- ID: ${conversation.userId}`);
      if (phoneToken) lines.push(`- Telefone: ${phoneToken}`);
      if (info?.name) lines.push(`- Nome: ${info.name}`);
      if (info?.role)
        lines.push(`- Papel: ${info.role}${info.isDoctor ? ' (médico)' : ''}`);
      if (info?.ownerId) lines.push(`- Clínica (ownerId): ${info.ownerId}`);
      if (info?.accessibleDoctors?.length) {
        const list = info.accessibleDoctors
          .map((d) => `${d.name || 'sem nome'} (id=${d.id})`)
          .join('; ');
        lines.push(`- Médicos acessíveis: ${list}`);
      }
      lines.push(
        'IMPORTANTE: O usuário é um profissional da clínica (médico ou colaborador) já autenticado. NUNCA o oriente a "se cadastrar na plataforma" — ele já está dentro do sistema.',
      );

      const userBlock = lines.join('\n');
      messages.push({ role: 'system', content: userBlock });
      breakdown.system_tokens += estimateTokens(userBlock);
    }

    let summaryText: string | null = null;
    let memoryText: string | null = null;

    if (strategy === 'hybrid') {
      if (conversation.conversationSummary) {
        summaryText = `RESUMO DA CONVERSA (use apenas como contexto, não repita literalmente):\n${conversation.conversationSummary}`;
      }
      if (
        conversation.conversationMemory &&
        Object.keys(conversation.conversationMemory).length > 0
      ) {
        const memJson = JSON.stringify(conversation.conversationMemory);
        memoryText = `MEMÓRIA ESTRUTURADA DA CONVERSA (slots/fatos confirmados):\n${memJson}`;
      }
    }

    // SC EM CONSTRUÇÃO — bloco SEMPRE incluído (qualquer strategy) quando
    // houver entidades já mencionadas/coletadas em turnos anteriores. Sem
    // isso, o LLM "esquece" o procedimento que o usuário falou três turnos
    // atrás e volta a perguntar, causando o loop.
    const scBuildingBlock = this.buildSurgeryRequestBuildingBlock(
      conversation.conversationMemory,
    );
    if (scBuildingBlock) {
      messages.push({ role: 'system', content: scBuildingBlock });
      breakdown.system_tokens += estimateTokens(scBuildingBlock);
    }

    let ragBlock: string | null = ragContext
      ? `CONTEXTO RELEVANTE DA BASE DE CONHECIMENTO:\n${ragContext}`
      : null;

    const trimmedRecent = [...recent];

    const computeUsage = () => {
      let used = breakdown.system_tokens;
      const summaryTokens = summaryText ? estimateTokens(summaryText) : 0;
      const memoryTokens = memoryText ? estimateTokens(memoryText) : 0;
      const ragTokens = ragBlock ? estimateTokens(ragBlock) : 0;
      const recentTokens = trimmedRecent.reduce(
        (acc, m) => acc + estimateTokens(m.content),
        0,
      );
      used += summaryTokens + memoryTokens + ragTokens + recentTokens;
      return { used, summaryTokens, memoryTokens, ragTokens, recentTokens };
    };

    let usage = computeUsage();

    // Ordem de corte (3.4 do plano): rag → recent older → summary.
    // Memória estruturada e system prompt nunca são cortados.
    while (usage.used > budget && ragBlock) {
      ragBlock = null;
      usage = computeUsage();
    }
    while (usage.used > budget && trimmedRecent.length > 3) {
      trimmedRecent.shift();
      usage = computeUsage();
    }
    while (usage.used > budget && summaryText) {
      summaryText = null;
      usage = computeUsage();
    }

    if (summaryText) {
      messages.push({ role: 'system', content: summaryText });
      breakdown.summary_tokens = usage.summaryTokens;
    }
    if (memoryText) {
      messages.push({ role: 'system', content: memoryText });
      breakdown.memory_tokens = usage.memoryTokens;
    }
    if (ragBlock) {
      messages.push({ role: 'system', content: ragBlock });
      breakdown.rag_tokens = usage.ragTokens;
    }
    for (const msg of trimmedRecent) {
      messages.push({ role: msg.role as any, content: msg.content });
    }
    breakdown.recent_tokens = usage.recentTokens;
    breakdown.totalTokens =
      breakdown.system_tokens +
      breakdown.summary_tokens +
      breakdown.memory_tokens +
      breakdown.rag_tokens +
      breakdown.recent_tokens;

    return {
      messages,
      breakdown,
      strategy,
      recentCount: trimmedRecent.length,
    };
  }

  /**
   * Decide se vale a pena rodar `updateSummaryAndMemory` agora.
   * Gatilhos (qualquer um disparar):
   *   - mensagens novas desde o último summary >= AI_SUMMARY_TRIGGER_EVERY_MESSAGES;
   *   - janela recente acumulou > 1200 tokens;
   *   - mudança de intent (memory.intent != intent novo).
   */
  async shouldRefreshSummary(
    conversation: WhatsappConversation,
    newIntentHint?: string,
  ): Promise<boolean> {
    const failures = conversation.conversationMemory?.summary_failures ?? 0;
    if (failures >= SUMMARY_FAILURE_LIMIT) return false;

    const trigger = this.getSummaryTriggerEvery();
    const since = conversation.summaryUpdatedAt
      ? await this.messageRepo.findRecentByConversation(conversation.id, 100)
      : await this.messageRepo.findRecentByConversation(conversation.id, 100);
    const newMessages = conversation.summaryUpdatedAt
      ? since.filter(
          (m) => m.createdAt > (conversation.summaryUpdatedAt as Date),
        )
      : since;

    if (newMessages.length >= trigger) return true;

    const recentTokens = newMessages.reduce(
      (acc, m) => acc + estimateTokens(m.content),
      0,
    );
    if (recentTokens > 1200) return true;

    if (
      newIntentHint &&
      conversation.conversationMemory?.intent &&
      newIntentHint !== conversation.conversationMemory.intent
    ) {
      return true;
    }

    return false;
  }

  /**
   * Gera/atualiza summary + memory para a conversa. Usa modelo barato e prompt
   * compacto. Em caso de falha, incrementa contador `summary_failures` da
   * memória; ao atingir `SUMMARY_FAILURE_LIMIT`, o orchestrator cai para
   * `history_only` automaticamente (lido por shouldRefreshSummary/buildContext).
   */
  async updateSummaryAndMemory(conversationId: string): Promise<void> {
    const conv = await this.conversationRepo.findOne({ id: conversationId });
    if (!conv) return;

    const recent = await this.messageRepo.findRecentByConversation(
      conversationId,
      40,
    );
    if (!recent.length) return;

    const previousSummary = conv.conversationSummary || '';
    const previousMemory = conv.conversationMemory || {};

    const newMessagesSinceLast = conv.summaryUpdatedAt
      ? recent.filter((m) => m.createdAt > (conv.summaryUpdatedAt as Date))
      : recent;

    if (!newMessagesSinceLast.length) return;

    const transcript = newMessagesSinceLast
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt = [
      'Você é um sumarizador interno. Sua tarefa é manter o resumo + memória da conversa atualizados, sem inventar dados.',
      'Receba: (1) resumo anterior, (2) memória estruturada, (3) últimas mensagens.',
      'Atualize sem perder fatos confirmados, removendo redundâncias e mantendo incertezas como perguntas em aberto.',
      'Se houver tokens no formato {{categoria_n}} (PII pseudonimizada), preserve-os EXATAMENTE como estão. Não tente substituir, decifrar ou inventar valores reais.',
      'IMPORTANTE: se o usuário estiver no meio de uma ação (criando SC, contestando, agendando, enviando para análise etc.), registre no campo "pending_action" da memória um objeto com: "type" (ex: "create_sc", "advance_status", "update_opme"), "description" (o que o usuário quer fazer em uma frase), e "missing_data" (lista dos dados ainda não fornecidos). Se não houver ação pendente, omita o campo.',
      'Saída em JSON estrito com chaves "summary" (string) e "memory" (objeto). Sem texto fora do JSON.',
    ].join(' ');

    const userPayload = JSON.stringify({
      previous_summary: previousSummary,
      previous_memory: previousMemory,
      new_messages: transcript,
    });

    try {
      const completion = await this.openaiService.chatCompletion({
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userPayload },
        ],
        temperature: 0.1,
        maxTokens: this.getSummaryMaxTokens(),
        timeoutMs: 20000,
      });

      const raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const parsed = this.safeParseSummary(raw);
      if (!parsed) {
        await this.recordSummaryFailure(conv);
        this.logger.warn(
          `[CONTEXT_SUMMARY] conv=${conversationId} parse_failed raw_len=${raw.length}`,
        );
        return;
      }

      // Bloqueia resíduos de PII estruturada não tokenizada (defesa em
      // profundidade). Tokens {{cat_n}} permanecem.
      const residual = this.piiVault.detectResidualPii(parsed.summary || '');
      if (residual.length) {
        await this.recordSummaryFailure(conv);
        this.logger.warn(
          `[CONTEXT_SUMMARY] conv=${conversationId} residual_pii=${residual
            .map((r) => r.category)
            .join(',')}`,
        );
        return;
      }

      // Fase 6 do Blueprint v3 — `conversationMemory` é PATCH-ONLY:
      // o LLM nunca pode reescrevê-la inteiramente (perderia
      // `pending_confirmation`, `awaitingMedia` etc. mantidos por
      // handlers determinísticos). O parser do summary ainda devolve
      // `parsed.memory`, mas usamos como **patch** sobre a memória atual.
      const baseMemory = (conv.conversationMemory ??
        {}) as ConversationMemory;
      const patch = (parsed.memory ?? {}) as Partial<ConversationMemory>;
      const newMemory: ConversationMemory = {
        ...mergeConversationMemory(baseMemory, patch),
        last_updated_at: new Date().toISOString(),
        summary_failures: 0,
      };

      await this.conversationRepo.update(conversationId, {
        conversationSummary: parsed.summary || null,
        conversationMemory: newMemory as any,
        summaryUpdatedAt: new Date(),
      });

      this.logger.debug(
        `[CONTEXT_SUMMARY] conv=${conversationId} updated summary_len=${(parsed.summary || '').length}`,
      );
    } catch (error) {
      await this.recordSummaryFailure(conv);
      this.logger.warn(
        `[CONTEXT_SUMMARY] conv=${conversationId} error=${
          (error as Error).message
        }`,
      );
    }
  }

  /** Limita janela recente. Sempre preserva par user→assistant mais recente. */
  trimRecentMessages<T extends { role: string; content: string }>(
    messages: T[],
    max: number,
  ): T[] {
    if (messages.length <= max) return messages;
    return messages.slice(-max);
  }

  /**
   * Aplica orçamento de tokens manualmente sobre blocos pré-formatados.
   * Útil para chamadas externas (testes ou integração customizada).
   */
  enforceTokenBudget(
    blocks: {
      kind: 'system' | 'summary' | 'memory' | 'rag' | 'recent';
      content: string;
    }[],
    budget: number,
  ): {
    blocks: typeof blocks;
    droppedKinds: Array<'rag' | 'recent' | 'summary'>;
  } {
    const droppedKinds: Array<'rag' | 'recent' | 'summary'> = [];
    const totalTokens = (b: typeof blocks) =>
      b.reduce((acc, item) => acc + estimateTokens(item.content), 0);
    const current = [...blocks];
    let tokens = totalTokens(current);

    while (tokens > budget) {
      const ragIndex = current.findIndex((b) => b.kind === 'rag');
      if (ragIndex >= 0) {
        current.splice(ragIndex, 1);
        droppedKinds.push('rag');
        tokens = totalTokens(current);
        continue;
      }
      const recentIndex = current.findIndex((b) => b.kind === 'recent');
      if (recentIndex >= 0) {
        current.splice(recentIndex, 1);
        droppedKinds.push('recent');
        tokens = totalTokens(current);
        continue;
      }
      const summaryIndex = current.findIndex((b) => b.kind === 'summary');
      if (summaryIndex >= 0) {
        current.splice(summaryIndex, 1);
        droppedKinds.push('summary');
        tokens = totalTokens(current);
        continue;
      }
      break;
    }

    return { blocks: current, droppedKinds };
  }

  private safeParseSummary(
    raw: string,
  ): { summary: string; memory: ConversationMemory } | null {
    if (!raw) return null;
    let candidate = raw.trim();
    // Remove fences ```json ... ```
    if (candidate.startsWith('```')) {
      candidate = candidate
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/, '');
    }
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed?.summary !== 'string') return null;
      const memory =
        parsed.memory && typeof parsed.memory === 'object' ? parsed.memory : {};
      return { summary: parsed.summary, memory };
    } catch {
      return null;
    }
  }

  private async recordSummaryFailure(
    conversation: WhatsappConversation,
  ): Promise<void> {
    const memory = conversation.conversationMemory || {};
    const failures = (memory.summary_failures ?? 0) + 1;
    await this.conversationRepo.update(conversation.id, {
      conversationMemory: { ...memory, summary_failures: failures } as any,
    });
  }
}
