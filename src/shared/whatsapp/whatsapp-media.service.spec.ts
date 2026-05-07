import { ConfigService } from '@nestjs/config';
import {
  WhatsappMediaService,
  WhatsappMediaValidationError,
} from './whatsapp-media.service';

describe('WhatsappMediaService', () => {
  const configValues: Record<string, any> = {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'token_test',
    AI_AUDIO_ALLOWED_MIME: 'audio/ogg,audio/mpeg',
    AI_AUDIO_MAX_BYTES: 8,
    AI_AUDIO_MAX_DURATION_SECONDS: 60,
    AI_AUDIO_DEBUG_PERSIST: 'false',
  };

  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: any) =>
      key in configValues ? configValues[key] : defaultValue,
    ),
  } as unknown as ConfigService;

  let service: WhatsappMediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhatsappMediaService(configServiceMock);
    (global as any).fetch = jest.fn();
  });

  it('deve baixar áudio com autenticação básica da Twilio', async () => {
    const payload = Buffer.from('1234567');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          if (name === 'content-length') return String(payload.byteLength);
          if (name === 'content-type') return 'audio/ogg';
          return null;
        },
      },
      body: null,
      arrayBuffer: async () =>
        payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength,
        ),
    });

    const result = await service.downloadInboundAudio({
      url: 'https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages/MM1/Media/ME1',
      contentType: 'audio/ogg',
      category: 'audio',
    });

    expect(result.sizeBytes).toBe(7);
    expect(result.mimeType).toBe('audio/ogg');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('AC_test:token_test').toString('base64')}`,
        }),
      }),
    );
  });

  it('deve bloquear MIME não permitido', async () => {
    await expect(
      service.downloadInboundAudio({
        url: 'https://api.twilio.com/media/1',
        contentType: 'image/jpeg',
        category: 'other',
      }),
    ).rejects.toBeInstanceOf(WhatsappMediaValidationError);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('deve bloquear arquivo acima do limite', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          if (name === 'content-length') return '999';
          if (name === 'content-type') return 'audio/ogg';
          return null;
        },
      },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(
      service.downloadInboundAudio({
        url: 'https://api.twilio.com/media/1',
        contentType: 'audio/ogg',
        category: 'audio',
      }),
    ).rejects.toBeInstanceOf(WhatsappMediaValidationError);
  });
});
