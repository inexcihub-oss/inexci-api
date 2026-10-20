import { ConfigService } from '@nestjs/config';
import { FasterWhisperProvider } from './faster-whisper.provider';

function buildProvider(values: Record<string, unknown>) {
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;
  return new FasterWhisperProvider(configService);
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        text: 'olá',
        language: 'pt',
        confidence: 0.9,
        durationSeconds: 3,
      }),
    text: () => Promise.resolve(''),
  };
}

describe('FasterWhisperProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const request = {
    audioBuffer: Buffer.from('audio'),
    mimeType: 'audio/ogg',
    fileName: 'nota.ogg',
    language: 'pt',
  };

  function sentHeaders(): Record<string, string> {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return init.headers as Record<string, string>;
  }

  it('envia o X-STT-Token quando AI_STT_SHARED_TOKEN está configurado', async () => {
    const provider = buildProvider({
      AI_STT_FASTER_WHISPER_URL: 'http://stt-service:8000/',
      AI_STT_SHARED_TOKEN: '  segredo-compartilhado  ',
    });

    const result = await provider.transcribe(request);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://stt-service:8000/transcribe',
      expect.any(Object),
    );
    expect(sentHeaders()['x-stt-token']).toBe('segredo-compartilhado');
    expect(result.text).toBe('olá');
  });

  it('não envia o header quando o token está vazio', async () => {
    const provider = buildProvider({ AI_STT_SHARED_TOKEN: '' });

    await provider.transcribe(request);

    expect(sentHeaders()).not.toHaveProperty('x-stt-token');
    expect(sentHeaders()['x-file-name']).toBe('nota.ogg');
  });

  it('propaga o 401 do serviço como erro', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('token inválido'),
    });
    const provider = buildProvider({ AI_STT_SHARED_TOKEN: 'errado' });

    await expect(provider.transcribe(request)).rejects.toThrow(
      'faster-whisper retornou status 401: token inválido',
    );
  });
});
