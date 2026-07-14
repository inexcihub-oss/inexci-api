/**
 * Fase 2 do `PLANO-OBSERVABILIDADE-GRAFANA.md`.
 *
 * Métricas custom da INEXCI (histogramas de duração + contadores de negócio),
 * exportadas via OTLP quando `OTEL_METRICS_ENABLED=true` (ver `otel.ts`).
 * Quando o SDK de métricas não está inicializado, `metrics.getMeter()` do
 * `@opentelemetry/api` devolve um meter no-op — os `record`/`add` abaixo são
 * seguros de chamar incondicionalmente, mesmo com o pipeline desligado.
 *
 * IMPORTANTE: os instrumentos abaixo são criados uma única vez, na carga do
 * módulo (`createHistogram`/`createCounter` no topo). A API de métricas do
 * OTel (diferente da de traces) NÃO tem delegação tardia: se este módulo for
 * carregado antes de `initOtel()` registrar o MeterProvider global (via
 * `sdk.start()`), os instrumentos ficam presos ao provider noop para sempre.
 * Por isso `otel.ts` NÃO importa este arquivo — só `meter-name.const.ts`
 * (sem side effects). Este módulo só deve ser importado por código que roda
 * depois do bootstrap (services do Nest, carregados via `AppModule`).
 */
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
