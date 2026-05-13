import { Injectable, Logger } from '@nestjs/common';
import { WhatsappConversationRepository } from '../../../../database/repositories/whatsapp-conversation.repository';
import { ConversationService } from '../conversation.service';
import { parseToolResult } from '../../tools/tool-result';

/** Rótulo amigável de cada tool, usado nas mensagens determinísticas. */
export const TOOL_DISPLAY_LABELS: Record<string, string> = {
  upload_doctor_signature: 'atualizar sua assinatura digital',
  sc_draft_preview: 'criar a solicitação cirúrgica',
  sc_draft_commit: 'criar a solicitação cirúrgica',
  patient_draft_preview: 'cadastrar o paciente',
  patient_draft_commit: 'cadastrar o paciente',
  hospital_draft_preview: 'cadastrar o hospital',
  hospital_draft_commit: 'cadastrar o hospital',
  health_plan_draft_preview: 'cadastrar o convênio',
  health_plan_draft_commit: 'cadastrar o convênio',
  procedure_draft_preview: 'cadastrar o procedimento',
  procedure_draft_commit: 'cadastrar o procedimento',
  invoice_draft_preview: 'registrar o faturamento',
  invoice_draft_commit: 'registrar o faturamento',
  contestation_draft_preview: 'registrar a contestação',
  contestation_draft_commit: 'registrar a contestação',
  scheduling_draft_preview: 'agendar a cirurgia',
  scheduling_draft_commit: 'agendar a cirurgia',
  update_sc_draft_preview: 'atualizar os dados da solicitação',
  update_sc_draft_commit: 'atualizar os dados da solicitação',
  send_sc_draft_preview: 'enviar a solicitação para análise',
  send_sc_draft_commit: 'enviar a solicitação para análise',
  start_analysis_draft_preview: 'iniciar a análise da solicitação',
  start_analysis_draft_commit: 'iniciar a análise da solicitação',
  accept_authorization_draft_preview: 'aceitar a autorização',
  accept_authorization_draft_commit: 'aceitar a autorização',
  mark_performed_draft_preview: 'marcar a cirurgia como realizada',
  mark_performed_draft_commit: 'marcar a cirurgia como realizada',
  // Tools de mutação direta (não seguem o padrão *_draft_*) — Fase 2 do
  // PLANO-CORRECOES-CODE-REVIEW-2026-05-13: agora retornam buildToolResult.
  set_hospital: 'atualizar o hospital da solicitação',
  set_health_plan: 'atualizar o convênio da solicitação',
  close_surgery_request: 'encerrar a solicitação cirúrgica',
  reschedule_surgery: 'reagendar a cirurgia',
  confirm_receipt: 'confirmar o recebimento',
  update_receipt: 'atualizar os dados de recebimento',
  attach_document_from_whatsapp: 'anexar documento via WhatsApp',
  create_patient_from_document: 'cadastrar paciente via documento',
  manage_tuss_items: 'gerenciar itens TUSS',
  manage_documents: 'gerenciar documentos',
  manage_report_images: 'gerenciar imagens do laudo',
  manage_report_sections: 'gerenciar seções do laudo',
};

/**
 * Dado o nome de uma tool de draft (`*_draft_preview` ou `*_draft_commit`),
 * deduz qual tool deve ser re-executada com `confirm: true` quando o usuário
 * confirmar.
 *
 * Convenção:
 *  - `<base>_draft_preview` → re-chamar `<base>_draft_commit` com
 *    `{ confirm: true }`.
 *  - `<base>_draft_commit` retornando preview (sem confirm) → re-chamar a
 *    própria tool com `{ ...args, confirm: true }`.
 *
 * Retorna `null` para qualquer outro nome.
 */
export function inferDraftPendingTarget(
  toolName: string,
  toolArgs: Record<string, unknown>,
): { tool: string; args: Record<string, unknown> } | null {
  if (toolName.endsWith('_draft_preview')) {
    return {
      tool: toolName.replace(/_draft_preview$/, '_draft_commit'),
      args: { confirm: true },
    };
  }
  if (toolName.endsWith('_draft_commit')) {
    return {
      tool: toolName,
      args: { ...toolArgs, confirm: true },
    };
  }
  return null;
}

const PENDING_CONFIRMATION_MAX_AGE_MS = 15 * 60 * 1000;

const AFFIRMATIVE_PHRASES = new Set<string>([
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

const NEGATIVE_PHRASES = new Set<string>([
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
]);

interface PendingConfirmationPayload {
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

/**
 * Centraliza o "ciclo de confirmação" das tools de mutação:
 *
 *  - **`pending_confirmation`** persistido em `conversationMemory` por
 *    conversation. Lifecycle (set/clear/freshness check) e injeção do
 *    hint determinístico (`buildPendingConfirmationHint`).
 *  - **Reconhecimento de respostas** do usuário —
 *    `parseAffirmativeConfirmation`, `parseNegativeConfirmation`,
 *    `parseNumericChoice`.
 *  - **Hint para escolha numérica** quando o usuário responde "1", "opção
 *    2", etc. (`buildNumericChoiceHint`).
 *  - **Tracking pós-tool**: `trackPendingConfirmation` decide se grava ou
 *    limpa o `pending_confirmation` lendo o envelope canônico
 *    (`parseToolResult`). Sem fallback heurístico — Fase 4 do
 *    `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` removeu as detecções por string
 *    (`looksLikeConfirmationPreview` / `looksLikeExecutedMutation`) junto
 *    com o set `PREVIEWABLE_MUTATION_TOOLS`. Toda tool de mutação que
 *    queira participar do ciclo deve devolver `ToolResult` válido.
 *
 * Extraído do `AiOrchestratorService` na Fase 1 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`. Possui sua própria cópia de
 * `readConversationMemory`/`writeConversationMemoryPatch` para evitar
 * acoplamento bidirecional com o orchestrator (a deduplicação será feita
 * na Fase 2 quando MessageProcessor migrar a memória dele também).
 */
@Injectable()
export class ConfirmationManagerService {
  private readonly logger = new Logger(ConfirmationManagerService.name);

  constructor(
    private readonly whatsappConversationRepo: WhatsappConversationRepository,
    private readonly conversationService: ConversationService,
  ) {}

  // ============================================================
  // pending_confirmation lifecycle
  // ============================================================

  async setPendingConfirmation(
    conversationId: string,
    payload: PendingConfirmationPayload,
  ): Promise<void> {
    await this.writeConversationMemoryPatch(conversationId, {
      pending_confirmation: {
        ...payload,
        createdAt: new Date().toISOString(),
      },
    });
  }

  async clearPendingConfirmation(conversationId: string): Promise<void> {
    await this.writeConversationMemoryPatch(conversationId, {
      pending_confirmation: null,
    });
  }

  /**
   * Considera o pending_confirmation expirado se mais de 15 minutos
   * passaram. Evita "fantasmas" de confirmações antigas reagirem a um
   * "sim" inocente em uma nova conversa.
   */
  isPendingConfirmationFresh(createdAt: unknown): boolean {
    if (typeof createdAt !== 'string') return false;
    const ts = Date.parse(createdAt);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts <= PENDING_CONFIRMATION_MAX_AGE_MS;
  }

  /**
   * Considera "mutação confirmável" qualquer tool que segue o padrão
   * preview/commit (todas as `*_draft_preview` e `*_draft_commit`). Usado
   * para decidir se um resultado `status: 'ok'` deve limpar o
   * `pending_confirmation` da conversa — leituras (ex.: `query_patients`)
   * não devem limpá-lo.
   *
   * Tools fora desse padrão (ex.: `upload_doctor_signature`) também limpam
   * o pending implicitamente quando devolvem `ToolResult` com
   * `status: 'ok'` — porque a re-execução determinística é feita por nome
   * armazenado em `pending.tool`. Para essas, usamos o nome em
   * `TOOL_DISPLAY_LABELS` como sinal de confirmabilidade.
   */
  isMutationConfirmableTool(toolName: string): boolean {
    if (
      toolName.endsWith('_draft_commit') ||
      toolName.endsWith('_draft_preview')
    ) {
      return true;
    }
    return Object.prototype.hasOwnProperty.call(TOOL_DISPLAY_LABELS, toolName);
  }

  /**
   * Após a execução de cada tool, decide se grava/limpa o
   * `pending_confirmation` no `conversation_memory`. Chamado dentro do
   * loop de toolResults.
   *
   * **Único caminho** desde a Fase 4 do `PLANO-SANITIZACAO-CLEAN-CODE-IA`:
   * o envelope canônico `ToolResult`. Toda tool que queira participar
   * do ciclo de confirmação devolve `status: 'pending_confirmation'`
   * (com o `pending_confirmation` apontando qual tool re-executar) e
   * `status: 'ok'` quando a mutação for executada. Quando o output não
   * casa com o envelope, logamos um warning e seguimos sem mexer no
   * estado — o pending de outra mutação fica preservado.
   */
  async trackPendingConfirmation(opts: {
    conversationId: string;
    toolName: string;
    args: Record<string, unknown>;
    output: string;
  }): Promise<void> {
    const { conversationId, toolName, args, output } = opts;

    const parsed = parseToolResult(output);
    if (!parsed) {
      this.logger.warn(
        `[PENDING_CONFIRMATION] envelope_missing conv=${conversationId} tool=${toolName} — sem ToolResult válido; pending_confirmation não atualizado.`,
      );
      return;
    }

    if (parsed.status === 'ok') {
      if (this.isMutationConfirmableTool(toolName)) {
        await this.clearPendingConfirmation(conversationId);
      }
      return;
    }

    if (parsed.status === 'pending_confirmation') {
      let target: { tool: string; args: Record<string, unknown> } | null = null;
      let description: string | null = null;

      const meta = parsed.pending_confirmation;
      if (meta && typeof meta.tool === 'string') {
        target = {
          tool: meta.tool,
          args:
            meta.args && typeof meta.args === 'object'
              ? { ...meta.args, confirm: true }
              : { confirm: true },
        };
        description =
          (typeof meta.description === 'string' && meta.description) ||
          TOOL_DISPLAY_LABELS[meta.tool] ||
          null;
      } else {
        target = inferDraftPendingTarget(toolName, args);
      }

      if (!target) return;

      const finalDescription =
        description ||
        TOOL_DISPLAY_LABELS[target.tool] ||
        TOOL_DISPLAY_LABELS[toolName] ||
        `executar ${target.tool}`;

      await this.setPendingConfirmation(conversationId, {
        tool: target.tool,
        args: target.args,
        description: finalDescription,
      });
      this.logger.log(
        `[PENDING_CONFIRMATION] saved conv=${conversationId} source=${toolName} tool=${target.tool}`,
      );
      return;
    }

    // Para outros status (`needs_input`, `blocked`, `error`) não mexemos
    // no pending — o usuário ainda pode estar respondendo a um preview
    // anterior.
  }

  // ============================================================
  // Hints determinísticos para o LLM
  // ============================================================

  /**
   * Constrói um hint imperativo quando há pending_confirmation fresco e o
   * usuário respondeu com confirmação ("sim", "ok", etc.). O hint força o
   * LLM a chamar a tool indicada exatamente com os args salvos +
   * `confirm: true`, evitando o velho "não ficou claro o que confirmou".
   *
   * Se o usuário negou explicitamente (não/cancela/esquece), retorna hint
   * de cancelamento e limpa o estado.
   */
  async buildPendingConfirmationHint(
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
   * Quando o usuário responde apenas com um dígito (ou variação curta) e a
   * última mensagem do assistente terminou com uma lista numerada, monta um
   * bloco system determinístico instruindo o LLM a executar a opção
   * escolhida (sem voltar a perguntar "qual ação você quer?").
   */
  async buildNumericChoiceHint(
    conversationId: string,
    rawInput: string,
  ): Promise<string | null> {
    const digit = this.parseNumericChoice(rawInput);
    if (!digit) return null;
    try {
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

  // ============================================================
  // Parsers de input (também reaproveitados pelo orchestrator)
  // ============================================================

  /**
   * Detecta entradas de confirmação afirmativa ("sim", "confirmo", "ok",
   * "pode mandar", etc.). Usado em conjunto com
   * `conversationMemory.pending_confirmation` para re-executar uma tool de
   * mutação determinada sem depender do LLM lembrar do contexto.
   */
  parseAffirmativeConfirmation(rawInput: string): boolean {
    if (!rawInput) return false;
    const normalized = this.normalize(rawInput);
    if (!normalized || normalized.length > 60) return false;
    return AFFIRMATIVE_PHRASES.has(normalized);
  }

  /** Detecta cancelamento / negativa explícita ("não", "cancela", "pare"). */
  parseNegativeConfirmation(rawInput: string): boolean {
    if (!rawInput) return false;
    const normalized = this.normalize(rawInput);
    if (!normalized || normalized.length > 60) return false;
    return NEGATIVE_PHRASES.has(normalized);
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
  parseNumericChoice(rawInput: string): number | null {
    if (!rawInput) return null;
    const normalized = this.normalize(rawInput);
    if (!normalized || normalized.length > 30) return null;

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
  extractNumberedOptionsFromText(text: string): Record<number, string> {
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

  // ============================================================
  // Helpers privados
  // ============================================================

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private async readConversationMemory(
    conversationId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const conv = await this.whatsappConversationRepo.findOne({
        id: conversationId,
      } as never);
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
      } as never);
      if (!conv) return;
      const memory = (conv.conversationMemory as Record<string, unknown>) || {};
      await this.whatsappConversationRepo.update(conversationId, {
        conversationMemory: { ...memory, ...patch } as never,
      });
    } catch (err) {
      this.logger.debug(
        `[PENDING_CONFIRMATION] write_failed conv=${conversationId} err=${(err as Error)?.message}`,
      );
    }
  }
}
