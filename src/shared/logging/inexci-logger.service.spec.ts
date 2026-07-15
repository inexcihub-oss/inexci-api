import { InexciLogger } from './inexci-logger.service';
import { requestContextStorage } from './request-context';

describe('InexciLogger', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let originalLogPretty: string | undefined;
  let originalNodeEnv: string | undefined;

  function lastJsonLine(spy: jest.SpyInstance): Record<string, unknown> {
    const raw = spy.mock.calls[spy.mock.calls.length - 1][0] as string;
    return JSON.parse(raw.trim());
  }

  beforeEach(() => {
    originalLogPretty = process.env.LOG_PRETTY;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.LOG_PRETTY = 'false';
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLogPretty === undefined) delete process.env.LOG_PRETTY;
    else process.env.LOG_PRETTY = originalLogPretty;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('mensagens string simples vão para o campo "message" (não achatadas)', () => {
    const logger = new InexciLogger();
    logger.log('SELECT surgery_requests', 'TypeORM');

    const payload = lastJsonLine(stdoutSpy);
    expect(payload.message).toBe('SELECT surgery_requests');
    expect(payload.context).toBe('TypeORM');
    expect(payload.event).toBeUndefined();
  });

  it('payload estruturado (objeto) é achatado no nível raiz, sem aninhar em "message"', () => {
    const logger = new InexciLogger();
    logger.log({
      event: 'http_request',
      method: 'GET',
      url: '/auth/health',
      statusCode: 200,
      durationMs: 1,
      userId: null,
      tenantId: null,
      ip: '127.0.0.1',
    });

    const payload = lastJsonLine(stdoutSpy);
    expect(payload.event).toBe('http_request');
    expect(payload.method).toBe('GET');
    expect(payload.statusCode).toBe(200);
    // Não deve existir um campo "message" contendo JSON serializado.
    expect(payload.message).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('\\"event\\"');
  });

  it('herda userId/tenantId do contexto de request quando a mensagem é uma string', () => {
    const logger = new InexciLogger();
    requestContextStorage.run(
      { requestId: 'req-1', userId: 'user-abc', tenantId: 'tenant-abc' },
      () => {
        logger.error(
          'value too long for type character varying(75)',
          undefined,
          'Trace',
        );
      },
    );

    const payload = lastJsonLine(stderrSpy);
    expect(payload.userId).toBe('user-abc');
    expect(payload.tenantId).toBe('tenant-abc');
    expect(payload.requestId).toBe('req-1');
    expect(payload.message).toBe(
      'value too long for type character varying(75)',
    );
  });

  it('mantém userId explícito (mesmo null) do payload estruturado em vez de sobrescrever com o contexto', () => {
    const logger = new InexciLogger();
    requestContextStorage.run(
      { requestId: 'req-2', userId: 'user-do-contexto', tenantId: 'tenant-x' },
      () => {
        logger.log({
          event: 'http_request',
          method: 'GET',
          url: '/webhooks/twilio',
          statusCode: 200,
          durationMs: 5,
          userId: null,
          tenantId: null,
          ip: '10.0.0.1',
        });
      },
    );

    const payload = lastJsonLine(stdoutSpy);
    expect(payload.userId).toBeNull();
    expect(payload.tenantId).toBeNull();
  });

  it('injeta userId do contexto em payload estruturado que não define o campo', () => {
    const logger = new InexciLogger();
    requestContextStorage.run(
      {
        requestId: 'req-3',
        userId: 'user-herdado',
        tenantId: 'tenant-herdado',
      },
      () => {
        logger.log({ event: 'custom_business_event', foo: 'bar' });
      },
    );

    const payload = lastJsonLine(stdoutSpy);
    expect(payload.userId).toBe('user-herdado');
    expect(payload.tenantId).toBe('tenant-herdado');
    expect(payload.foo).toBe('bar');
  });
});
