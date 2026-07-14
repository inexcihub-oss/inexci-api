import { normalizeOtlpEndpoint, parseOtlHeaders } from './otel';

describe('normalizeOtlpEndpoint', () => {
  it('completa o path quando recebe a URL base do gateway', () => {
    expect(
      normalizeOtlpEndpoint(
        'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp',
        '/v1/traces',
      ),
    ).toBe('https://otlp-gateway-prod-sa-east-1.grafana.net/otlp/v1/traces');
  });

  it('não duplica o path quando a URL já vem completa', () => {
    expect(
      normalizeOtlpEndpoint(
        'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp/v1/traces',
        '/v1/traces',
      ),
    ).toBe('https://otlp-gateway-prod-sa-east-1.grafana.net/otlp/v1/traces');
  });

  it('remove barra final antes de completar o path', () => {
    expect(normalizeOtlpEndpoint('http://alloy:4318/', '/v1/metrics')).toBe(
      'http://alloy:4318/v1/metrics',
    );
  });

  it('usa o path de métricas quando solicitado', () => {
    expect(normalizeOtlpEndpoint('http://alloy:4318', '/v1/metrics')).toBe(
      'http://alloy:4318/v1/metrics',
    );
  });
});

describe('parseOtlHeaders', () => {
  it('retorna undefined para valor vazio ou ausente', () => {
    expect(parseOtlHeaders(undefined)).toBeUndefined();
    expect(parseOtlHeaders('')).toBeUndefined();
    expect(parseOtlHeaders('   ')).toBeUndefined();
  });

  it('faz parse de um único header', () => {
    expect(parseOtlHeaders('Authorization=Basic abc123')).toEqual({
      Authorization: 'Basic abc123',
    });
  });

  it('faz parse de múltiplos headers separados por vírgula', () => {
    expect(parseOtlHeaders('A=1,B=2')).toEqual({ A: '1', B: '2' });
  });

  it('ignora segmentos sem "="', () => {
    expect(parseOtlHeaders('A=1,invalido,B=2')).toEqual({ A: '1', B: '2' });
  });

  it('preserva "=" dentro do valor (ex.: base64 com padding)', () => {
    expect(parseOtlHeaders('Authorization=Basic abc123==')).toEqual({
      Authorization: 'Basic abc123==',
    });
  });
});

describe('initOtel', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;
    delete process.env.OTEL_METRICS_ENABLED;
    delete process.env.OTEL_METRICS_EXPORTER;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function mockSdkDependencies() {
    const startMock = jest.fn();
    const nodeSdkCtor = jest.fn().mockImplementation(() => ({
      start: startMock,
      shutdown: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: nodeSdkCtor,
    }));
    jest.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: jest.fn().mockImplementation((opts) => opts),
    }));
    const metricExporterCtor = jest.fn().mockImplementation((opts) => opts);
    jest.doMock('@opentelemetry/exporter-metrics-otlp-http', () => ({
      OTLPMetricExporter: metricExporterCtor,
    }));
    return { nodeSdkCtor, startMock, metricExporterCtor };
  }

  it('não inicializa o SDK quando não há endpoint configurado', () => {
    const { nodeSdkCtor } = mockSdkDependencies();
    const { initOtel } = require('./otel');

    initOtel();

    expect(nodeSdkCtor).not.toHaveBeenCalled();
  });

  it('inicializa sem metricReaders/views quando OTEL_METRICS_ENABLED não é "true"', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp';
    const { nodeSdkCtor, startMock, metricExporterCtor } =
      mockSdkDependencies();
    const { initOtel } = require('./otel');

    initOtel();

    expect(nodeSdkCtor).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
    const config = nodeSdkCtor.mock.calls[0][0];
    expect(config.metricReaders).toBeUndefined();
    expect(config.views).toBeUndefined();
    expect(metricExporterCtor).not.toHaveBeenCalled();
    // Guarda o auto-configurado do NodeSDK para não duplicar/errar export.
    expect(process.env.OTEL_METRICS_EXPORTER).toBe('none');
  });

  it('registra PeriodicExportingMetricReader com buckets explícitos quando OTEL_METRICS_ENABLED=true', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp';
    process.env.OTEL_METRICS_ENABLED = 'true';
    const { nodeSdkCtor, metricExporterCtor } = mockSdkDependencies();
    const { initOtel, HISTOGRAM_BOUNDARIES_MS } = require('./otel');

    initOtel();

    expect(nodeSdkCtor).toHaveBeenCalledTimes(1);
    const config = nodeSdkCtor.mock.calls[0][0];
    expect(config.metricReaders).toHaveLength(1);
    expect(config.views).toEqual([
      expect.objectContaining({
        instrumentType: expect.anything(),
        aggregation: expect.objectContaining({
          options: expect.objectContaining({
            boundaries: HISTOGRAM_BOUNDARIES_MS,
          }),
        }),
      }),
    ]);
    expect(metricExporterCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp/v1/metrics',
      }),
    );
  });

  it('chama initOtel() uma segunda vez sem recriar o SDK (singleton)', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp';
    const { nodeSdkCtor } = mockSdkDependencies();
    const { initOtel } = require('./otel');

    initOtel();
    initOtel();

    expect(nodeSdkCtor).toHaveBeenCalledTimes(1);
  });
});
