/**
 * Fase 8 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`.
 *
 * Inicialização mínima do OpenTelemetry SDK.
 * Deve ser chamada ANTES do `bootstrap()` do Nest em `main.ts` para garantir
 * que os instrumentors se registrem antes dos módulos serem carregados.
 *
 * Só ativa quando `OTEL_EXPORTER_OTLP_ENDPOINT` está configurado (Grafana Tempo,
 * Mimir, etc.). Sem endpoint: SDK não sobe — acompanhamento fica nos logs
 * estruturados (`http_request`, `[Trace]`, `SLOW`).
 *
 * Variáveis de ambiente:
 *  - `OTEL_EXPORTER_OTLP_ENDPOINT` — URL do coletor OTLP.
 *  - `OTEL_EXPORTER_OTLP_HEADERS` — credenciais (ex.: Grafana Cloud).
 *  - `OTEL_TRACES_SAMPLER_ARG` — fração amostrada 0–1 (default: 1.0 dev, 0.1 prod).
 *  - `OTEL_METRICS_ENABLED` — liga o pipeline de métricas (histogramas p50/p90/p99).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import {
  AggregationType,
  InstrumentType,
  PeriodicExportingMetricReader,
  ViewOptions,
} from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { METER_NAME } from './meter-name.const';

/** Buckets (ms) adequados a latência de API web: HTTP, SQL e etapas de IA. */
export const HISTOGRAM_BOUNDARIES_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

let sdk: NodeSDK | null = null;

export function initOtel(): void {
  if (sdk) return;

  const rawEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  if (!rawEndpoint) return;

  // O SDK não loga falhas internas (ex.: 401 do exporter OTLP) sem um diag
  // logger registrado. ERROR mantém o volume baixo em produção.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  // O NodeSDK, mesmo sem `metricReaders` explícito, cria automaticamente um
  // PeriodicExportingMetricReader a partir de OTEL_EXPORTER_OTLP_ENDPOINT
  // (padrão do SDK). Como abaixo registramos nosso próprio reader (com
  // buckets de histograma explícitos) apenas quando OTEL_METRICS_ENABLED for
  // 'true', desligamos o auto-configurado do SDK sempre — evita duplicar
  // export de métricas (um com buckets default, outro com os nossos) quando
  // a flag está ligada, e evita 404 de um reader órfão quando está desligada.
  process.env.OTEL_METRICS_EXPORTER = 'none';

  // Mesmo raciocínio para Logs: o NodeSDK auto-registra um LoggerProvider
  // OTLP (para `{endpoint}/v1/logs`) sempre que OTEL_EXPORTER_OTLP_ENDPOINT
  // está setado, mesmo sem pedirmos. Isso captura eventos GenAI automáticos
  // de instrumentações (ex.: @opentelemetry/instrumentation-openai) que não
  // fazem parte do pipeline intencional (a api não usa a Logs API do OTel —
  // o InexciLogger é um logger próprio) e não têm rota configurada no
  // coletor, gerando 404 sem trazer benefício. Ver PLANO-OBSERVABILIDADE-GRAFANA.md.
  process.env.OTEL_LOGS_EXPORTER = 'none';

  // Os exporters OTLP usam a URL como veio, sem completar path — normalizamos
  // aqui para aceitar tanto a base do gateway (".../otlp") quanto uma URL já
  // completa (".../otlp/v1/traces"), evitando duplicar o sufixo.
  const endpoint = normalizeOtlpEndpoint(rawEndpoint, '/v1/traces');
  const metricsEndpoint = normalizeOtlpEndpoint(rawEndpoint, '/v1/metrics');

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
  const metricsEnabled =
    (process.env.OTEL_METRICS_ENABLED ?? '').toLowerCase() === 'true';

  const histogramView: ViewOptions = {
    meterName: METER_NAME,
    instrumentType: InstrumentType.HISTOGRAM,
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: HISTOGRAM_BOUNDARIES_MS },
    },
  };

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'inexci-api' }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint, headers })),
    ],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplerArg),
    }),
    ...(metricsEnabled
      ? {
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({
                url: metricsEndpoint,
                headers,
              }),
            }),
          ],
          views: [histogramView],
        }
      : {}),
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

/**
 * Aceita a URL base do gateway OTLP (ex.: `.../otlp`) ou uma URL já completa
 * com o `path` informado (ex.: `.../otlp/v1/traces`), sem duplicar o sufixo.
 */
export function normalizeOtlpEndpoint(
  rawEndpoint: string,
  path: '/v1/traces' | '/v1/metrics',
): string {
  return rawEndpoint.endsWith(path)
    ? rawEndpoint
    : `${rawEndpoint.replace(/\/+$/, '')}${path}`;
}

export function parseOtlHeaders(
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
