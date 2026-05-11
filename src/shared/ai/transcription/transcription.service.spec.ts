import { ConfigService } from '@nestjs/config';
import { TranscriptionService } from './transcription.service';

describe('TranscriptionService', () => {
  const configValues: Record<string, string> = {
    AI_TRANSCRIPTION_PROVIDER: 'faster_whisper',
    AI_STT_ENABLE_FALLBACK: 'false',
  };

  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: any) =>
      key in configValues ? configValues[key] : defaultValue,
    ),
  } as unknown as ConfigService;

  const fasterWhisperProviderMock = {
    transcribe: jest.fn(),
  };

  const openaiWhisperProviderMock = {
    transcribe: jest.fn(),
  };

  let service: TranscriptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.AI_TRANSCRIPTION_PROVIDER = 'faster_whisper';
    configValues.AI_STT_ENABLE_FALLBACK = 'false';

    service = new TranscriptionService(
      configServiceMock,
      fasterWhisperProviderMock as any,
      openaiWhisperProviderMock as any,
    );
  });

  it('deve usar provider primário configurado', async () => {
    fasterWhisperProviderMock.transcribe.mockResolvedValue({
      text: '  Olá   mundo  ',
      provider: 'faster_whisper',
      latencyMs: 120,
      language: 'pt',
    });

    const result = await service.transcribe({
      audioBuffer: Buffer.from('abc'),
      mimeType: 'audio/ogg',
    });

    expect(result.text).toBe('Olá mundo');
    expect(result.provider).toBe('faster_whisper');
    expect(openaiWhisperProviderMock.transcribe).not.toHaveBeenCalled();
  });

  it('deve usar fallback quando habilitado e primário falhar', async () => {
    configValues.AI_STT_ENABLE_FALLBACK = 'true';

    fasterWhisperProviderMock.transcribe.mockRejectedValue(
      new Error('timeout'),
    );
    openaiWhisperProviderMock.transcribe.mockResolvedValue({
      text: 'Texto fallback',
      provider: 'openai',
      latencyMs: 450,
      language: 'pt-BR',
    });

    const result = await service.transcribe({
      audioBuffer: Buffer.from('abc'),
      mimeType: 'audio/ogg',
    });

    expect(result.provider).toBe('openai');
    expect(result.fallbackUsed).toBe(true);
    expect(openaiWhisperProviderMock.transcribe).toHaveBeenCalledTimes(1);
  });

  it('deve propagar erro quando fallback também falhar', async () => {
    configValues.AI_STT_ENABLE_FALLBACK = 'true';

    fasterWhisperProviderMock.transcribe.mockRejectedValue(
      new Error('erro primário'),
    );
    openaiWhisperProviderMock.transcribe.mockRejectedValue(
      new Error('erro fallback'),
    );

    await expect(
      service.transcribe({
        audioBuffer: Buffer.from('abc'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow('erro fallback');
  });

  describe('postProcessSpokenText (via normalizeResult)', () => {
    async function transcribe(text: string): Promise<string> {
      fasterWhisperProviderMock.transcribe.mockResolvedValue({
        text,
        provider: 'faster_whisper',
        latencyMs: 100,
        language: 'pt-BR',
      });
      const result = await service.transcribe({
        audioBuffer: Buffer.from('x'),
        mimeType: 'audio/ogg',
      });
      return result.text;
    }

    it('substitui "arroba" por "@" em e-mails ditados', async () => {
      const out = await transcribe('Meu e-mail é joao arroba teste ponto com');
      expect(out).toContain('joao@teste.com');
    });

    it('substitui "ponto br/net" pela TLD correta', async () => {
      expect(await transcribe('site exemplo ponto br')).toContain('exemplo.br');
      expect(await transcribe('email a arroba b ponto net')).toContain(
        'a@b.net',
      );
    });

    it('junta dígitos de telefone falados com espaços', async () => {
      const out = await transcribe('meu telefone é 31 99999 9999');
      expect(out).toContain('31999999999');
    });

    it('aceita "(31) 9 9999-9999" → grupo de dígitos juntos', async () => {
      const out = await transcribe('telefone 31 9 9999 9999');
      expect(out).toContain('31999999999');
    });

    it('mantém texto sem ruído inalterado', async () => {
      const out = await transcribe('preciso ver a SC do João');
      expect(out).toBe('preciso ver a SC do João');
    });
  });
});
