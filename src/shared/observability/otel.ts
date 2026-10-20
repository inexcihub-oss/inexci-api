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

export const HISTOGRAM_BOUNDARIES_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

let sdk: NodeSDK | null = null;

export function initOtel(): void {
  if (sdk) return;

  const rawEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  if (!rawEndpoint) return;

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  process.env.OTEL_METRICS_EXPORTER = 'none';

  process.env.OTEL_LOGS_EXPORTER = 'none';

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
