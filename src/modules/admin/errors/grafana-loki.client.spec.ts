import {
  GrafanaLokiClient,
  LokiUnavailableError,
  escapeLogqlString,
  parseLokiLine,
} from './grafana-loki.client';

function config(values: Record<string, string | undefined>) {
  return { get: jest.fn((key: string) => values[key]) };
}

const CONFIGURED = {
  GRAFANA_LOKI_READ_URL: 'https://logs.example.net/',
  GRAFANA_LOKI_READ_USER: '123',
  GRAFANA_LOKI_READ_TOKEN: 'tok',
};

describe('GrafanaLokiClient', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const range = {
    from: new Date('2026-10-28T10:00:00Z'),
    to: new Date('2026-10-28T11:00:00Z'),
    limit: 50,
  };

  it('sem URL, usuário ou token fica desligado e não chama a rede', async () => {
    const client = new GrafanaLokiClient(
      config({ GRAFANA_LOKI_READ_URL: 'https://x' }) as never,
    );
    expect(client.isConfigured()).toBe(false);
    await expect(
      client.searchByRequestIds(['r1'], range),
    ).rejects.toBeInstanceOf(LokiUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista vazia não consulta', async () => {
    const client = new GrafanaLokiClient(config(CONFIGURED) as never);
    await expect(client.searchByRequestIds([], range)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta query_range com basic auth, serviço e os requestIds, e mascara a mensagem', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            result: [
              {
                values: [
                  [
                    '1761645600000000000',
                    JSON.stringify({
                      level: 'error',
                      message: 'falhou para a@b.com',
                      context: 'ExceptionFilter',
                      requestId: 'r1',
                      traceId: 't1',
                    }),
                  ],
                ],
              },
            ],
          },
        }),
    });
    const client = new GrafanaLokiClient(config(CONFIGURED) as never);

    const lines = await client.searchByRequestIds(['r1', 'r1', 'r2'], range);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      url.startsWith('https://logs.example.net/loki/api/v1/query_range?'),
    ).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('query')).toBe(
      '{service="inexci-api"} |~ "r1|r2" | json',
    );
    expect(params.get('start')).toBe(`${range.from.getTime()}000000`);
    expect(params.get('direction')).toBe('backward');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('123:tok').toString('base64')}`,
    );
    expect(lines).toEqual([
      {
        timestamp: new Date(1761645600000),
        level: 'error',
        message: 'falhou para ***',
        context: 'ExceptionFilter',
        requestId: 'r1',
        traceId: 't1',
      },
    ]);
  });

  it('erro HTTP ou de rede vira LokiUnavailableError', async () => {
    const client = new GrafanaLokiClient(config(CONFIGURED) as never);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(
      client.searchByRequestIds(['r1'], range),
    ).rejects.toBeInstanceOf(LokiUnavailableError);
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      client.searchByRequestIds(['r1'], range),
    ).rejects.toBeInstanceOf(LokiUnavailableError);
  });

  it('linha que não é JSON vira mensagem crua', () => {
    expect(parseLokiLine('1000000', 'texto solto').message).toBe('texto solto');
  });

  it('escapa aspas e barras do LogQL', () => {
    expect(escapeLogqlString('a"b\\c')).toBe('a\\"b\\\\c');
  });
});
