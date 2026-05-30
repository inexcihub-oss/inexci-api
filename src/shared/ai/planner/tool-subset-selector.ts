import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ToolRegistryService } from '../services/tool-registry.service';
import { OperationDraftType } from '../drafts/operation-draft.types';
import { PlanResult } from './planner.types';

/**
 * Sempre incluído (independente de plan). Tools "infraestruturais" que
 * o orchestrator pode precisar a qualquer momento (cancelar, pedir status,
 * ou abrir novo plan).
 */
const ALWAYS_INCLUDE: ReadonlySet<string> = new Set([
  'plan_actions',
  'draft_status',
  'draft_cancel',
  'draft_update',
]);

/**
 * Seleciona o subconjunto de tools a enviar à OpenAI no turno (Fase 3 do
 * Blueprint v3).
 *
 * Regras:
 *   1. Sempre inclui `ALWAYS_INCLUDE`.
 *   2. Inclui as `next_tool_candidates` do plan (se conhecidas).
 *   3. Inclui todas as tools do `draftType` ativo (já filtradas pelo
 *      `ToolRegistryService.getToolDefinitionsForDraft`).
 *   4. Para queries (`query_*`, `search_*`, `get_*`): inclui sempre que
 *      a intent for de leitura.
 *
 * Garantia: o subconjunto resultante NUNCA cresce além do que o draft
 * já permite — só ENCOLHE. Falha-segura: se subset ficar vazio, devolve
 * o set original do draft.
 */
@Injectable()
export class ToolSubsetSelector {
  private readonly logger = new Logger(ToolSubsetSelector.name);

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  select(input: {
    plan: PlanResult;
    activeDraftType: OperationDraftType | null;
    /** Quando true, devolve o full set (modo pré-rollout). */
    bypass?: boolean;
  }): OpenAI.ChatCompletionTool[] {
    const fullSet = this.toolRegistry.getToolDefinitionsForDraft(
      input.activeDraftType,
    );

    if (input.bypass) return fullSet;

    const allowed = this.computeAllowedNames(input.plan);

    // Lookup tools (search_*, query_*, get_*) sempre liberadas para
    // não quebrar fluxos de "pergunte primeiro" sem precisar do planner.
    const subset = fullSet.filter((t) => {
      const name = t.function?.name ?? '';
      if (ALWAYS_INCLUDE.has(name)) return true;
      if (allowed.has(name)) return true;
      if (
        name.startsWith('query_') ||
        name.startsWith('search_') ||
        name.startsWith('get_') ||
        name.startsWith('list_')
      )
        return true;
      // Tools do draft ativo permanecem para suportar campos não-listados
      // pelo planner (ex.: `*_draft_preview`, `*_draft_commit`).
      if (input.activeDraftType && name.includes('_draft_')) return true;
      return false;
    });

    if (subset.length === 0) {
      this.logger.warn(
        `[TOOL_SUBSET] subset vazio (intent=${input.plan.intent}, draft=${input.activeDraftType ?? 'none'}); usando full set como fallback`,
      );
      return fullSet;
    }

    const reduction = fullSet.length - subset.length;
    if (reduction > 0) {
      this.logger.log(
        `[TOOL_SUBSET] full=${fullSet.length} subset=${subset.length} reduction=${reduction} intent=${input.plan.intent} draft=${input.activeDraftType ?? 'none'}`,
      );
    }
    return subset;
  }

  private computeAllowedNames(plan: PlanResult): Set<string> {
    return new Set([...plan.next_tool_candidates]);
  }
}
