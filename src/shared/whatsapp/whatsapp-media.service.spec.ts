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
    AI_DOC_ALLOWED_IMAGE_MIME: 'image/jpeg,image/png,image/webp',
    AI_DOC_ALLOWED_PDF_MIME: 'application/pdf',
    AI_DOC_MAX_BYTES: 16,
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

  describe('downloadInboundDocument', () => {
    it('deve baixar imagem JPG válida e expor kind=image', async () => {
      const payload = Buffer.from('hello-jpeg');

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === 'content-length') return String(payload.byteLength);
            if (name === 'content-type') return 'image/jpeg';
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

      const result = await service.downloadInboundDocument({
        url: 'https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages/MM2/Media/ME2',
        contentType: 'image/jpeg',
        category: 'image',
      });

      expect(result.kind).toBe('image');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.sizeBytes).toBe(payload.byteLength);
      expect(result.fileName.endsWith('.jpg')).toBe(true);
    });

    it('deve baixar PDF válido e expor kind=pdf', async () => {
      const payload = Buffer.from('%PDF-1.4');

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === 'content-length') return String(payload.byteLength);
            if (name === 'content-type') return 'application/pdf';
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

      const result = await service.downloadInboundDocument({
        url: 'https://api.twilio.com/media/pdf-0',
        contentType: 'application/pdf',
        category: 'pdf',
      });

      expect(result.kind).toBe('pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.fileName.endsWith('.pdf')).toBe(true);
    });

    it('deve rejeitar MIME não permitido para documento (gif)', async () => {
      await expect(
        service.downloadInboundDocument({
          url: 'https://api.twilio.com/media/2',
          contentType: 'image/gif',
          category: 'image',
        }),
      ).rejects.toMatchObject({ code: 'DOC_NOT_ALLOWED' });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('deve rejeitar documento acima do limite', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === 'content-length') return '99999';
            if (name === 'content-type') return 'application/pdf';
            return null;
          },
        },
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await expect(
        service.downloadInboundDocument({
          url: 'https://api.twilio.com/media/3',
          contentType: 'application/pdf',
          category: 'pdf',
        }),
      ).rejects.toMatchObject({ code: 'DOC_TOO_LARGE' });
    });

    it('deve rejeitar URL fora dos hosts confiáveis', async () => {
      await expect(
        service.downloadInboundDocument({
          url: 'https://malicioso.example.com/media/1',
          contentType: 'image/png',
          category: 'image',
        }),
      ).rejects.toMatchObject({ code: 'MEDIA_URL_INVALID' });
    });
  });
});
