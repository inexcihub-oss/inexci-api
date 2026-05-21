import { Injectable } from '@nestjs/common';
import {
  PlannerOutput,
  RuntimeState,
  SemanticInputEnvelope,
} from '../../contracts/agentic-architecture.contracts';
import { DeterministicIntentClassifierService } from './deterministic-intent-classifier.service';
import { PlannerLlmService } from './planner-llm.service';

@Injectable()
export class PlannerService {
  constructor(
    private readonly deterministicClassifier: DeterministicIntentClassifierService,
    private readonly plannerLlm: PlannerLlmService,
  ) {}

  async plan(input: {
    normalizedInput: string;
    semanticInput: SemanticInputEnvelope;
    runtimeState: RuntimeState;
  }): Promise<PlannerOutput> {
    const deterministic = this.deterministicClassifier.classify(
      input.normalizedInput,
    );
    if (deterministic && deterministic.confidence >= 0.8) {
      return this.buildOutput({
        intent: deterministic.intent,
        semanticInput: input.semanticInput,
        runtimeState: input.runtimeState,
        confidence: deterministic.confidence,
        nextBestAction: `Executar ou continuar o fluxo ${deterministic.intent}.`,
        needsRetrieval:
          deterministic.intent === 'faq' ||
          deterministic.intent === 'lookup_surgery_request',
        retrievalCategory:
          deterministic.intent === 'faq'
            ? 'faq'
            : deterministic.intent === 'lookup_surgery_request'
              ? 'workflow'
              : null,
      });
    }

    const llm = await this.plannerLlm.classify({
      normalizedInput: input.normalizedInput,
    });

    return this.buildOutput({
      intent: llm?.intent || deterministic?.intent || 'unknown',
      semanticInput: input.semanticInput,
      runtimeState: input.runtimeState,
      confidence: llm?.confidence ?? deterministic?.confidence ?? 0.4,
      nextBestAction:
        llm?.nextBestAction ||
        'Esclarecer a intenção do usuário com o menor próximo passo possível.',
      needsRetrieval:
        llm?.needsRetrieval ?? input.semanticInput.normalizedText.length >= 20,
      retrievalCategory: llm?.retrievalCategory ?? null,
    });
  }

  private buildOutput(input: {
    intent: string;
    semanticInput: SemanticInputEnvelope;
    runtimeState: RuntimeState;
    confidence: number;
    nextBestAction: string;
    needsRetrieval: boolean;
    retrievalCategory: string | null;
  }): PlannerOutput {
    const workflow =
      input.intent === 'unknown'
        ? input.runtimeState.activeWorkflow === 'idle'
          ? 'unknown'
          : input.runtimeState.activeWorkflow
        : (input.intent as PlannerOutput['workflow']);

    return {
      version: '1.0',
      intent: input.intent,
      workflow,
      entitiesDetected: input.semanticInput.entities,
      missingFields: input.runtimeState.missingFields,
      nextBestAction: input.nextBestAction,
      toolCandidate:
        input.intent === 'unknown'
          ? null
          : input.intent === 'lookup_surgery_request'
            ? 'query_surgery_requests'
            : input.intent === 'faq'
              ? null
              : 'plan_actions',
      needsRetrieval: input.needsRetrieval,
      retrievalCategory: input.retrievalCategory,
      needsVision: false,
      confidence: input.confidence,
      fallbackPlan:
        'Se a intenção continuar ambígua, fazer uma pergunta curta de desambiguação.',
    };
  }
}
