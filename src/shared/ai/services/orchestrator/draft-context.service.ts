import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { OperationDraftService } from '../operation-draft.service';
import { ToolRegistryService, detectDraftType } from '../tool-registry.service';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { PROMPT_VERSION } from '../../prompts/system-prompt';

/**
 * Tools de mutação por draft que precisam de `plan_actions` antes de
 * serem chamadas. Conjunto vivo: qualquer tool com sufixo `_draft_commit`
 * é sempre incluída automaticamente; `_draft_preview` também porque ele
 * imprime resumo "como se fosse" executar.
 *
 * Tools fora de drafts (advance_surgery_request, set_*, manage_*)
 * NÃO precisam de plan_actions — já têm seus próprios previews curtos.
 */
function isMutationDraftTool(toolName: string): boolean {
  return (
    toolName.endsWith('_draft_commit') || toolName.endsWith('_draft_preview')
  );
}

@Injectable()
export class DraftContextService {
  private readonly logger = new Logger(DraftContextService.name);

  constructor(
    private readonly operationDraftService: OperationDraftService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async buildToolsForDraft(conversationId: string): Promise<{
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

  buildCacheKey(activeDraftType: OperationDraftType | null): string {
    return `inexci:wa:v${PROMPT_VERSION}:draft=${activeDraftType ?? 'none'}`;
  }

  /**
   * Implementação **real** do plan-first guard (Fase 3 do Blueprint v3).
   *
   * Antes da Fase 3 esta função sempre devolvia um `Set` vazio (no-op),
   * deixando o LLM livre para chamar mutações sem `plan_actions`. Agora
   * bloqueamos mutações draft-based quando:
   *   - não há draft ativo, OU
   *   - há draft ativo mas o tool chamado pertence a OUTRO draft type
   *
   * Retorna o conjunto de **`tool_call.id`s** rejeitados (o
   * `ToolLoopRunner` injeta um resultado de erro `PLAN_ACTIONS_REQUIRED`
   * para cada um e instrui o LLM a chamar `plan_actions` antes).
   *
   * Falha-segura: em caso de erro consultando o draft, NÃO bloqueia.
   *
   * Pode ser desabilitado via env `AI_PLANNER_V3=false` (ver constante
   * abaixo) — quando desligado mantém o comportamento no-op antigo.
   */
  async evaluatePlanFirstGuard(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined,
    conversationId: string,
    options?: { enabled?: boolean },
  ): Promise<Set<string>> {
    if (!toolCalls?.length) return new Set<string>();
    if (options?.enabled === false) return new Set<string>();

    const blocked = new Set<string>();
    const blockedNames: string[] = [];
    let activeDraftType: OperationDraftType | null = null;
    try {
      const current =
        await this.operationDraftService.getCurrent(conversationId);
      activeDraftType = current?.type ?? null;
    } catch (err) {
      this.logger.warn(
        `[PLAN_GUARD] falha ao consultar draft conv=${conversationId}: ${String(
          (err as Error)?.message ?? err,
        )}; sem bloqueio`,
      );
      return blocked;
    }

    for (const call of toolCalls) {
      const name = call.function?.name;
      if (!name) continue;

      if (name === 'plan_actions') continue;
      if (!isMutationDraftTool(name)) continue;

      const requiredDraft = detectDraftType(name);
      if (!requiredDraft) continue;

      if (activeDraftType !== requiredDraft) {
        blocked.add(call.id);
        blockedNames.push(name);
      }
    }

    if (blocked.size > 0) {
      this.logger.log(
        `[PLAN_GUARD] blocked=${blockedNames.join(',')} active=${activeDraftType ?? 'none'} conv=${conversationId}`,
      );
    }

    return blocked;
  }
}
