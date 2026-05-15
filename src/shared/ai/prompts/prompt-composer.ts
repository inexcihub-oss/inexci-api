import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { CORE_PROMPT, CORE_PROMPT_VERSION } from './core.prompt';
import {
  WORKFLOW_MODULES,
  MULTIMODAL_AUDIO_REVIEW_MODULE,
  MULTIMODAL_DOC_REVIEW_MODULE,
} from './modules';
import { OperationalState } from '../state/operational-state.types';
import { OperationalStateBuilder } from '../state/operational-state.builder';

export interface ComposedPrompt {
  systemMessages: OpenAI.ChatCompletionMessageParam[];
  /** Estável dentro de uma combinação `(workflow + multimodalKind)`. */
  cacheKey: string;
}

/**
 * Compõe o conjunto de mensagens `system` enviado ao LLM no início de
 * cada turno (Fase 2 do Blueprint v3).
 *
 * Ordem canônica:
 *   1. CORE_PROMPT (constante; alvo de prompt cache da OpenAI)
 *   2. Módulo do workflow ativo (quando há draft)
 *   3. Módulo multimodal (`doc_review` ou `audio_review`) quando aplicável
 *   4. OPERATIONAL_STATE (volátil; sempre por último)
 *
 * O `cacheKey` cobre só a parte ESTÁVEL (1+2+3), garantindo que o
 * estado volátil não invalide o prefixo cacheado.
 */
@Injectable()
export class PromptComposer {
  constructor(private readonly stateBuilder: OperationalStateBuilder) {}

  compose(state: OperationalState): ComposedPrompt {
    const systemMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: CORE_PROMPT },
    ];

    const workflowModule = state.activeWorkflow
      ? WORKFLOW_MODULES[state.activeWorkflow.name]
      : null;
    if (workflowModule) {
      systemMessages.push({ role: 'system', content: workflowModule });
    }

    if (state.multimodalContext.docPending) {
      systemMessages.push({
        role: 'system',
        content: MULTIMODAL_DOC_REVIEW_MODULE,
      });
    }
    if (state.multimodalContext.audioPending?.summary) {
      systemMessages.push({
        role: 'system',
        content: MULTIMODAL_AUDIO_REVIEW_MODULE,
      });
    }

    systemMessages.push({
      role: 'system',
      content: this.stateBuilder.serialize(state),
    });

    const stateCacheKey = this.stateBuilder.cacheKey(state);
    const cacheKey = `inexci:wa:v${CORE_PROMPT_VERSION}:${stateCacheKey}`;

    return { systemMessages, cacheKey };
  }
}
