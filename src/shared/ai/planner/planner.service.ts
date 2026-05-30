import { Injectable, Logger } from '@nestjs/common';
import { OperationalState } from '../state/operational-state.types';
import { DeterministicIntentClassifier } from './deterministic-intent-classifier';
import { PlannerLlmService } from './planner-llm.service';
import { PlanResult } from './planner.types';

/**
 * Façade do planner (Fase 3 do Blueprint v3).
 *
 * Pipeline:
 *   1. `DeterministicIntentClassifier` (regex + keywords)
 *   2. Se `confidence < 0.85` ou `risk in {'medium','high'}`:
 *      → `PlannerLlmService` (cheap tier, structured output)
 *   3. Output canônico `PlanResult`
 *
 * Telemetria: cada chamada loga `[AI_PLANNER] source=... intent=... conf=...`.
 */
@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    private readonly deterministic: DeterministicIntentClassifier,
    private readonly llm: PlannerLlmService,
  ) {}

  async plan(input: {
    text: string;
    state: OperationalState;
    /** Quando true, pula direto para o LLM (debug/forçado). */
    forceLlm?: boolean;
    /** Quando true, NUNCA chama o LLM (modo offline/teste). */
    deterministicOnly?: boolean;
  }): Promise<PlanResult> {
    const det = this.deterministic.classify({
      text: input.text,
      state: input.state,
    });

    const skipLlm = input.deterministicOnly === true;
    const shouldLlm =
      input.forceLlm === true ||
      (!skipLlm &&
        (det.confidence < 0.85 || det.risk === 'high' || det.intent === 'unknown'));

    if (!shouldLlm) {
      this.log(det);
      return det;
    }

    const llm = await this.llm.plan({
      text: input.text,
      state: input.state,
      reason:
        det.intent === 'unknown' || det.confidence < 0.85
          ? 'low_confidence_deterministic'
          : 'risk_medium_or_high',
    });

    const merged: PlanResult = {
      ...llm,
      // Determinístico tem prioridade em entidades já extraídas (regex de TUSS/CID/data).
      entities: { ...llm.entities, ...det.entities },
      missing_fields: det.missing_fields,
      source: 'hybrid',
    };
    this.log(merged);
    return merged;
  }

  private log(plan: PlanResult): void {
    this.logger.log(
      `[AI_PLANNER] source=${plan.source} intent=${plan.intent} conf=${plan.confidence.toFixed(2)} risk=${plan.risk} candidates=${plan.next_tool_candidates.join(',') || 'none'}`,
    );
  }
}
