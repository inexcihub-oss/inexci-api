import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import { AiTool, AI_TOOL, ToolContext } from '../tools/tool.interface';
import { OperationDraftType } from '../drafts/operation-draft.types';

/**
 * Mapa de prefixos (até `_draft_`) para o tipo de draft correspondente.
 * Usado para filtrar a lista de tools enviada ao LLM com base no draft
 * ativo, evitando estourar o limite de 128 tools por chamada da OpenAI.
 */
const DRAFT_PREFIX_TO_TYPE: Record<string, OperationDraftType> = {
  sc: 'create_sc',
  patient: 'create_patient',
  hospital: 'create_hospital',
  health_plan: 'create_health_plan',
  procedure: 'create_procedure',
  invoice: 'invoice',
  contestation: 'contestation',
  scheduling: 'scheduling',
  update_sc: 'update_sc',
  send_sc: 'send_sc',
  start_analysis: 'start_analysis',
  accept_authorization: 'accept_authorization',
  mark_performed: 'mark_performed',
};

export function detectDraftType(toolName: string): OperationDraftType | null {
  const idx = toolName.indexOf('_draft_');
  if (idx === -1) return null;
  const prefix = toolName.slice(0, idx);
  return DRAFT_PREFIX_TO_TYPE[prefix] ?? null;
}

/**
 * Chave usada no `definitionsCache` para "sem draft ativo".
 * Mantemos como string (em vez de `null`) para simplificar o `Map`.
 */
const NO_DRAFT_CACHE_KEY = 'none';

/**
 * Tools globais de draft — expostas SOMENTE quando há um draft ativo
 * (qualquer tipo).
 *
 * A partir da Fase 5 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, são as únicas
 * tools de manipulação de campos de draft (`*_draft_set_*`, `*_draft_status`,
 * `*_draft_cancel` per-type foram removidos). Nomes não seguem o padrão
 * `*_draft_*` com prefixo, por isso precisam de tratamento especial em
 * `computeDefinitionsForDraft`.
 */
const GLOBAL_DRAFT_TOOL_NAMES = new Set([
  'draft_update',
  'draft_status',
  'draft_cancel',
]);

/**
 * Lista exaustiva de chaves possíveis para `getToolDefinitionsForDraft`.
 * Usada no warmup do cache (`OnModuleInit`). Derivada de `DRAFT_PREFIX_TO_TYPE`
 * para evitar drift — adicionar um novo draft type lá já o inclui aqui.
 */
const ALL_CACHE_KEYS: readonly string[] = [
  NO_DRAFT_CACHE_KEY,
  ...new Set(Object.values(DRAFT_PREFIX_TO_TYPE)),
];

/**
 * Serviço de registro de tools de IA.
 *
 * Fase 6 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`: elimina o service locator
 * de 30+ deps substituindo-o por `@Inject(AI_TOOL) allTools: AiTool[]`.
 * A fábrica que constrói o array vive em `tools/ai-tools.module.ts` e é
 * registrada como provider no `AiModule`. Adicionar uma nova tool não requer
 * mais tocar neste arquivo.
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);

  /**
   * `Map` preserva ordem de inserção (garantia ECMAScript). Essa ordem é
   * usada literalmente em `getToolDefinitionsForDraft`, e o array resultante
   * compõe o **prefixo** do request enviado à OpenAI. O hash do prefixo é
   * o que define o hit/miss do prompt caching, então **nunca reordene**
   * a lista em `ai-tools.module.ts` sem bumpar `PROMPT_VERSION` — a Fase 1
   * do `PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA.md` depende dessa estabilidade.
   */
  private readonly tools = new Map<string, AiTool>();

  /**
   * Cache imutável das definitions por chave (`'none'` ou `OperationDraftType`).
   * Pré-populado no `onModuleInit` — depois disso, `getToolDefinitionsForDraft`
   * é uma simples leitura O(1) e devolve sempre a **mesma referência** ao array.
   * Isso é importante para o prompt caching: arrays diferentes com mesmo
   * conteúdo poderiam mudar a serialização (ex.: ordem de chaves) e quebrar
   * o hit. Manter a referência fixa é a garantia mais forte de estabilidade.
   * Fase 2 do `PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA.md`.
   */
  private readonly definitionsCache = new Map<
    string,
    OpenAI.ChatCompletionTool[]
  >();

  constructor(@Inject(AI_TOOL) allTools: AiTool[]) {
    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Pré-popula `definitionsCache` para todas as chaves possíveis. Roda 1×
   * no boot do app — depois disso, `getToolDefinitionsForDraft` é O(1) e
   * sempre devolve a mesma referência (boa para o prompt caching da OpenAI
   * e elimina alocação repetida em cada turno do WhatsApp).
   */
  onModuleInit(): void {
    for (const key of ALL_CACHE_KEYS) {
      const draftType =
        key === NO_DRAFT_CACHE_KEY ? null : (key as OperationDraftType);
      this.definitionsCache.set(
        key,
        this.computeDefinitionsForDraft(draftType),
      );
    }
    this.logger.log(
      `[TOOL_REGISTRY_WARMUP] cached_keys=${ALL_CACHE_KEYS.length} total_tools=${this.tools.size}`,
    );
  }

  getToolDefinitions(): OpenAI.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Retorna apenas as tools relevantes para o estado atual do draft.
   * - Tools que não são de draft (não contêm `_draft_` no nome) são sempre
   *   incluídas (~42 tools sempre disponíveis: plan, action, manage,
   *   catalog, general, notification, pendency, surgery-request,
   *   doctor-profile, whatsapp-flow).
   * - Tools de draft só aparecem quando o draft ativo for do tipo
   *   correspondente. Isso mantém a lista bem abaixo do limite de 128
   *   tools por request da OpenAI (138 tools no total).
   * - Quando não há draft ativo, nenhuma tool de draft é exposta — o LLM
   *   precisa chamar `plan_actions` para abrir o draft, e o filtro será
   *   recalculado no próximo follow-up dentro do mesmo turno.
   *
   * Implementação: lê do `definitionsCache` populado em `onModuleInit`. Em
   * caso de cache miss (caminho usado por testes que instanciam o registry
   * via `Object.create` sem chamar `onModuleInit`), recalcula on-the-fly
   * e memoiza para a próxima chamada.
   */
  getToolDefinitionsForDraft(
    activeDraftType: OperationDraftType | null,
  ): OpenAI.ChatCompletionTool[] {
    const key = activeDraftType ?? NO_DRAFT_CACHE_KEY;
    const cached = this.definitionsCache.get(key);
    if (cached) return cached;
    const computed = this.computeDefinitionsForDraft(activeDraftType);
    this.definitionsCache.set(key, computed);
    return computed;
  }

  /**
   * Lógica pura de filtragem — separada de `getToolDefinitionsForDraft`
   * para ser reusada pelo warmup do cache. Não cacheia: chamadores devem
   * passar pelo método público.
   *
   * Regras de inclusão (após a Fase 5 do
   * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`, com setters/status/cancel
   * per-type já removidos do disco):
   *  1. Tools globais de draft (`draft_update`, `draft_status`, `draft_cancel`):
   *     incluídas somente quando há draft ativo (qualquer tipo).
   *  2. Demais tools de draft (`*_draft_preview`, `*_draft_commit`,
   *     `mark_performed_draft_check_docs` e plan-only tools como
   *     `update_sc_draft_*`): incluídas somente quando o draft ativo for
   *     do tipo correspondente.
   *  3. Tools não-draft: sempre incluídas.
   */
  private computeDefinitionsForDraft(
    activeDraftType: OperationDraftType | null,
  ): OpenAI.ChatCompletionTool[] {
    const result: OpenAI.ChatCompletionTool[] = [];
    for (const tool of this.tools.values()) {
      const name = tool.name;

      if (GLOBAL_DRAFT_TOOL_NAMES.has(name)) {
        if (activeDraftType !== null) {
          result.push(tool.definition);
        }
        continue;
      }

      const draftType = detectDraftType(name);

      if (draftType === null) {
        result.push(tool.definition);
        continue;
      }

      if (activeDraftType && draftType === activeDraftType) {
        result.push(tool.definition);
      }
    }
    return result;
  }

  getTool(name: string): AiTool | undefined {
    return this.tools.get(name);
  }

  executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return Promise.resolve(`Ferramenta "${name}" não encontrada.`);
    return tool.execute(args, context);
  }
}
