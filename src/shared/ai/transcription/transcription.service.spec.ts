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
});
