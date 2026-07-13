/**
 * Fase 8 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`.
 *
 * Inicialização mínima do OpenTelemetry SDK.
 * Deve ser chamada ANTES do `bootstrap()` do Nest em `main.ts` para garantir
 * que os instrumentors se registrem antes dos módulos serem carregados.
 *
 * Só ativa quando `OTEL_EXPORTER_OTLP_ENDPOINT` está configurado (Grafana Tempo,
 * Jaeger, etc.). Sem endpoint: SDK não sobe — evita spans verbosos no stdout/
 * Dozzle; acompanhamento fica nos logs estruturados (`http_request`, `[Trace]`,
 * `SLOW`).
 *
 * Variáveis de ambiente:
 *  - `OTEL_EXPORTER_OTLP_ENDPOINT` — URL do coletor OTLP.
 *  - `OTEL_EXPORTER_OTLP_HEADERS` — credenciais (ex.: Grafana Cloud).
 *  - `OTEL_TRACES_SAMPLER_ARG` — fração amostrada 0–1 (default: 1.0 dev, 0.1 prod).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK | null = null;

export function initOtel(): void {
  if (sdk) return;

  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  if (!endpoint) return;

  const isProd = process.env.NODE_ENV === 'production';
  const samplerArg = Math.max(
    0,
    Math.min(
      1,
      parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG ?? '0') ||
        (isProd ? 0.1 : 1.0),
    ),
  );

  const headers = parseOtlHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'inexci-api' }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint, headers })),
    ],
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

function parseOtlHeaders(
  raw: string | undefined,
): Record<string, string> | undefined {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return undefined;
  const headers: Record<string, string> = {};
  for (const part of trimmed.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
