import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CAPTCHA_INVALIDO_MENSAGEM,
  CAPTCHA_OBRIGATORIO_MENSAGEM,
  TURNSTILE_VERIFY_URL,
  TurnstileService,
} from './turnstile.service';

function configCom(valores: Record<string, string | undefined>) {
  return { get: jest.fn((chave: string) => valores[chave]) } as any;
}

describe('TurnstileService', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('sem TURNSTILE_SECRET_KEY não exige token nem chama a Cloudflare', async () => {
    const service = new TurnstileService(configCom({}));

    await expect(service.assertHuman(undefined)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('com a chave configurada, recusa cadastro sem token', async () => {
    const service = new TurnstileService(
      configCom({ TURNSTILE_SECRET_KEY: 'segredo' }),
    );

    await expect(service.assertHuman('  ')).rejects.toThrow(
      new BadRequestException(CAPTCHA_OBRIGATORIO_MENSAGEM),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia segredo, token e IP ao siteverify e aceita success=true', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    });
    const service = new TurnstileService(
      configCom({ TURNSTILE_SECRET_KEY: 'segredo' }),
    );

    await expect(
      service.assertHuman('tok-1', '203.0.113.5'),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe('POST');
    const corpo = new URLSearchParams(init.body as string);
    expect(corpo.get('secret')).toBe('segredo');
    expect(corpo.get('response')).toBe('tok-1');
    expect(corpo.get('remoteip')).toBe('203.0.113.5');
  });

  it('recusa token que a Cloudflare marca como inválido', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: false,
        'error-codes': ['invalid-input-response'],
      }),
    });
    const service = new TurnstileService(
      configCom({ TURNSTILE_SECRET_KEY: 'segredo' }),
    );

    await expect(service.assertHuman('tok-ruim')).rejects.toThrow(
      new BadRequestException(CAPTCHA_INVALIDO_MENSAGEM),
    );
  });

  it('falha de rede vira 503 (fail-closed)', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    const service = new TurnstileService(
      configCom({ TURNSTILE_SECRET_KEY: 'segredo' }),
    );

    await expect(service.assertHuman('tok')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('HTTP de erro da Cloudflare também vira 503', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const service = new TurnstileService(
      configCom({ TURNSTILE_SECRET_KEY: 'segredo' }),
    );

    await expect(service.assertHuman('tok')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('avisa no boot quando está em produção sem a chave', () => {
    const service = new TurnstileService(configCom({ NODE_ENV: 'production' }));
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    service.onModuleInit();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('TURNSTILE_SECRET_KEY'),
    );
  });

  it('não avisa fora de produção nem quando a chave existe', () => {
    for (const valores of [
      { NODE_ENV: 'development' },
      { NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'segredo' },
    ]) {
      const service = new TurnstileService(configCom(valores));
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);
      service.onModuleInit();
      expect(warn).not.toHaveBeenCalled();
    }
  });
});
