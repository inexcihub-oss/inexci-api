import { AudioIntakeService } from './audio-intake.service';

const baseConfig = { get: jest.fn().mockReturnValue('true') };

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const whatsappMediaService = {
    isAudioMime: jest.fn().mockReturnValue(false),
    downloadInboundAudio: jest.fn(),
    ...overrides.whatsappMediaService,
  };
  const transcriptionService = {
    transcribe: jest.fn(),
    ...overrides.transcriptionService,
  };
  const configService = { ...baseConfig, ...overrides.configService };
  return new AudioIntakeService(
    whatsappMediaService as any,
    transcriptionService as any,
    configService as any,
  );
}

describe('AudioIntakeService', () => {
  describe('processInboundAudioIfNeeded', () => {
    it('retorna hasAudio=false quando não há mídia de áudio', async () => {
      const svc = makeService();
      const result = await svc.processInboundAudioIfNeeded({
        media: [
          {
            url: 'http://x',
            contentType: 'image/jpeg',
            category: 'image',
            durationSeconds: null,
          },
        ],
        messageSid: 'sid',
      });
      expect(result.hasAudio).toBe(false);
      expect(result.failed).toBe(false);
    });

    it('retorna transcrição quando processamento de áudio é bem-sucedido', async () => {
      const transcriptionData = {
        text: 'Olá mundo',
        provider: 'faster_whisper',
        language: 'pt',
        confidence: 0.95,
        durationSeconds: 3,
        latencyMs: 200,
        fallbackUsed: false,
      };
      const svc = makeService({
        whatsappMediaService: {
          isAudioMime: jest.fn().mockReturnValue(false),
          downloadInboundAudio: jest.fn().mockResolvedValue({
            buffer: Buffer.from(''),
            mimeType: 'audio/ogg',
            durationSeconds: 3,
            fileName: 'audio.ogg',
            sizeBytes: 1024,
          }),
        },
        transcriptionService: {
          transcribe: jest.fn().mockResolvedValue(transcriptionData),
        },
      });
      const result = await svc.processInboundAudioIfNeeded({
        media: [
          {
            url: 'http://audio',
            contentType: 'audio/ogg',
            category: 'audio',
            durationSeconds: 3,
          },
        ],
        messageSid: 'sid',
      });
      expect(result.hasAudio).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.transcription?.text).toBe('Olá mundo');
    });

    it('retorna failed=true quando transcrição lança erro', async () => {
      const svc = makeService({
        whatsappMediaService: {
          isAudioMime: jest.fn().mockReturnValue(false),
          downloadInboundAudio: jest
            .fn()
            .mockRejectedValue(new Error('transcrição vazia')),
        },
      });
      const result = await svc.processInboundAudioIfNeeded({
        media: [
          {
            url: 'http://audio',
            contentType: 'audio/ogg',
            category: 'audio',
            durationSeconds: 1,
          },
        ],
        messageSid: 'sid',
      });
      expect(result.hasAudio).toBe(true);
      expect(result.failed).toBe(true);
      expect(result.failureReason).toBe('STT_EMPTY_TRANSCRIPTION');
    });

    it('retorna hasAudio=false quando AI_AUDIO_ENABLED=false', async () => {
      const svc = makeService({
        configService: { get: jest.fn().mockReturnValue('false') },
      });
      const result = await svc.processInboundAudioIfNeeded({
        media: [
          {
            url: 'http://audio',
            contentType: 'audio/ogg',
            category: 'audio',
            durationSeconds: 1,
          },
        ],
        messageSid: 'sid',
      });
      expect(result.hasAudio).toBe(false);
    });
  });

  describe('buildUserInputForAi', () => {
    it('combina texto e transcrição quando ambos presentes', () => {
      const svc = makeService();
      const result = svc.buildUserInputForAi({
        textInput: 'olá',
        transcriptionText: 'preciso agendar',
      });
      expect(result).toBe('olá\n\nTranscrição do áudio: preciso agendar');
    });

    it('retorna apenas texto quando não há transcrição', () => {
      const svc = makeService();
      expect(
        svc.buildUserInputForAi({
          textInput: 'apenas texto',
          transcriptionText: null,
        }),
      ).toBe('apenas texto');
    });

    it('retorna apenas transcrição quando não há texto', () => {
      const svc = makeService();
      expect(
        svc.buildUserInputForAi({
          textInput: '',
          transcriptionText: 'audio transcrito',
        }),
      ).toBe('audio transcrito');
    });
  });
});
