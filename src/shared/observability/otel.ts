/**
 * Fase 8 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`.
 *
 * Inicialização mínima do OpenTelemetry SDK.
 * Deve ser chamada ANTES do `bootstrap()` do Nest em `main.ts` para garantir
 * que os instrumentors se registrem antes dos módulos serem carregados.
 *
 * Variáveis de ambiente:
 *  - `OTEL_EXPORTER_OTLP_ENDPOINT` — URL do coletor (Jaeger, Tempo, Grafana Cloud).
 *    Se omitida: `ConsoleSpanExporter` em dev/test; `NoopSpanProcessor` em produção.
 *  - `OTEL_TRACES_SAMPLER_ARG` — fração de traces amostrados (default 0.1 = 10 %).
 *    Em dev sem endpoint, usa 1.0 para facilitar inspeção local.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  NoopSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK | null = null;

export function initOtel(): void {
  if (sdk) return;

  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  const isProd = process.env.NODE_ENV === 'production';
  const samplerArg = Math.max(
    0,
    Math.min(
      1,
      parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG ?? '0') ||
        (isProd ? 0.1 : 1.0),
    ),
  );

  let spanProcessor;
  if (endpoint) {
    spanProcessor = new BatchSpanProcessor(
      new OTLPTraceExporter({ url: endpoint }),
    );
  } else {
    spanProcessor = new NoopSpanProcessor();
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'inexci-api' }),
    spanProcessors: [spanProcessor],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplerArg),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(() => {});
  });
}
