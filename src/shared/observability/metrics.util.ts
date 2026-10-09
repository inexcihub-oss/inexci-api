import { metrics } from '@opentelemetry/api';
import { METER_NAME } from './meter-name.const';

export { METER_NAME };

export function getMeter() {
  return metrics.getMeter(METER_NAME);
}

const aiProcessingDuration = getMeter().createHistogram(
  'inexci.ai.processing.duration',
  {
    unit: 'ms',
    description: 'Duração total do processMessage do orquestrador de IA.',
  },
);

const aiToolDuration = getMeter().createHistogram('inexci.ai.tool.duration', {
  unit: 'ms',
  description: 'Duração de execução de cada tool chamada pelo LLM.',
});

const openaiRequestDuration = getMeter().createHistogram(
  'inexci.openai.request.duration',
  {
    unit: 'ms',
    description: 'Duração de cada chamada de chat completion à OpenAI.',
  },
);

const openaiTokens = getMeter().createCounter('inexci.openai.tokens', {
  description: 'Tokens consumidos por chamada à OpenAI.',
});

const workflowTransitionCount = getMeter().createCounter(
  'inexci.workflow.transition.count',
  {
    description: 'Tentativas de transição de status da solicitação cirúrgica.',
  },
);

const queueJobDuration = getMeter().createHistogram(
  'inexci.queue.job.duration',
  {
    unit: 'ms',
    description: 'Duração de processamento de um job de fila Bull.',
  },
);

export function recordAiProcessingDuration(
  durationMs: number,
  attributes: { channel: string; intent: string; hadTools: boolean },
): void {
  aiProcessingDuration.record(durationMs, attributes);
}

export function recordAiToolDuration(
  durationMs: number,
  attributes: { tool: string },
): void {
  aiToolDuration.record(durationMs, attributes);
}

export function recordOpenaiRequestDuration(
  durationMs: number,
  attributes: { model: string; stage: string },
): void {
  openaiRequestDuration.record(durationMs, attributes);
}

export function recordOpenaiTokens(
  count: number,
  attributes: {
    model: string;
    stage: string;
    type: 'prompt' | 'completion' | 'total';
  },
): void {
  openaiTokens.add(count, attributes);
}

export function recordWorkflowTransition(attributes: {
  from: string | number;
  to: string | number;
  result: 'allowed' | 'blocked';
}): void {
  workflowTransitionCount.add(1, {
    from: String(attributes.from),
    to: String(attributes.to),
    result: attributes.result,
  });
}

export function recordQueueJobDuration(
  durationMs: number,
  attributes: { queue: string; status: 'completed' | 'failed' },
): void {
  queueJobDuration.record(durationMs, attributes);
}
