import { ConfigService } from '@nestjs/config';
import {
  WhatsappMediaService,
  WhatsappMediaValidationError,
} from '../../whatsapp/whatsapp-media.service';
import { StorageService } from '../../storage/storage.service';
import { AiRedisService } from './ai-redis.service';
import { WhatsappDocumentDispatcherService } from './whatsapp-document-dispatcher.service';

describe('WhatsappDocumentDispatcherService', () => {
  let configService: ConfigService;
  let mediaService: jest.Mocked<WhatsappMediaService>;
  let storageService: jest.Mocked<StorageService>;
  let redis: jest.Mocked<AiRedisService>;
  let service: WhatsappDocumentDispatcherService;

  const baseConfig: Record<string, any> = {
    AI_DOC_ENABLED: 'true',
    AI_DOC_PENDING_TTL_MINUTES: 10,
    AI_DOC_TMP_FOLDER: 'whatsapp-tmp',
  };

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string, defaultValue?: any) =>
        key in baseConfig ? baseConfig[key] : defaultValue,
      ),
    } as any;

    mediaService = {
      isImageMime: jest.fn(
        (mime: string | null | undefined) =>
          typeof mime === 'string' && mime.toLowerCase().startsWith('image/'),
      ),
      isPdfMime: jest.fn(
        (mime: string | null | undefined) =>
          typeof mime === 'string' && mime.toLowerCase() === 'application/pdf',
      ),
      isAudioMime: jest.fn(() => false),
      downloadInboundDocument: jest.fn(),
    } as any;

    storageService = {
      uploadBuffer: jest.fn(),
      delete: jest.fn(),
      listFolder: jest.fn(),
      deleteMany: jest.fn(),
    } as any;

    redis = {
      isAvailable: false,
      cacheGet: jest.fn(),
      cacheSet: jest.fn(),
      cacheDelete: jest.fn(),
    } as any;

    service = new WhatsappDocumentDispatcherService(
      configService,
      mediaService,
      storageService,
      redis,
    );
  });

  describe('isEnabled', () => {
    it('respeita AI_DOC_ENABLED=true', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('respeita AI_DOC_ENABLED=false', () => {
      baseConfig.AI_DOC_ENABLED = 'false';
      expect(service.isEnabled()).toBe(false);
      baseConfig.AI_DOC_ENABLED = 'true';
    });
  });

  describe('pickDocumentMedia', () => {
    it('seleciona a primeira mídia image/pdf', () => {
      const picked = service.pickDocumentMedia([
        { url: 'a', contentType: 'audio/ogg', category: 'audio' },
        { url: 'b', contentType: 'image/jpeg', category: 'image' },
        { url: 'c', contentType: 'application/pdf', category: 'pdf' },
      ]);

      expect(picked?.url).toBe('b');
    });

    it('ignora arrays vazios', () => {
      expect(service.pickDocumentMedia([])).toBeNull();
      expect(service.pickDocumentMedia(undefined)).toBeNull();
    });

    it('cai no fallback de MIME quando category=other', () => {
      const picked = service.pickDocumentMedia([
        { url: 'x', contentType: 'application/pdf', category: 'other' },
      ]);
      expect(picked?.url).toBe('x');
    });
  });

  describe('parseIntent', () => {
    it('reconhece números e palavras-chave', () => {
      expect(service.parseIntent('1')).toBe('attach');
      expect(service.parseIntent('Anexar')).toBe('attach');
      expect(service.parseIntent('2')).toBe('create_sc');
      expect(service.parseIntent('criar uma nova SC')).toBe('create_sc');
      expect(service.parseIntent('3')).toBe('create_patient');
      expect(service.parseIntent('Cadastrar paciente')).toBe('create_patient');
      expect(service.parseIntent('cancelar')).toBe('cancel');
    });

    it('retorna null quando o input não é uma intent clara', () => {
      expect(service.parseIntent('oi tudo bem')).toBeNull();
      expect(service.parseIntent('')).toBeNull();
      expect(service.parseIntent(null)).toBeNull();
    });
  });

  describe('stageInboundDocument', () => {
    it('faz download, sobe para o tmp e grava pendência', async () => {
      mediaService.downloadInboundDocument.mockResolvedValue({
        buffer: Buffer.from('hello'),
        mimeType: 'application/pdf',
        sizeBytes: 5,
        fileName: 'whatsapp-doc-1.pdf',
        kind: 'pdf',
      });
      storageService.uploadBuffer.mockResolvedValue(
        'whatsapp-tmp/uuid-doc.pdf',
      );

      const outcome = await service.stageInboundDocument({
        media: {
          url: 'https://api.twilio.com/media/0',
          contentType: 'application/pdf',
        },
        phone: '5511999990000',
        messageSid: 'SM-1',
      });

      expect(outcome.status).toBe('staged');
      expect(outcome.pending?.storagePath).toBe('whatsapp-tmp/uuid-doc.pdf');
      expect(outcome.pending?.kind).toBe('pdf');

      const stored = await service.getPending('5511999990000');
      expect(stored?.fileName).toBe('whatsapp-doc-1.pdf');
    });

    it('retorna failure quando o MIME é proibido', async () => {
      mediaService.downloadInboundDocument.mockRejectedValue(
        new WhatsappMediaValidationError(
          'gif não permitido',
          'DOC_NOT_ALLOWED',
        ),
      );

      const outcome = await service.stageInboundDocument({
        media: {
          url: 'https://api.twilio.com/media/x',
          contentType: 'image/gif',
        },
        phone: '5511999990000',
        messageSid: 'SM-2',
      });

      expect(outcome.status).toBe('failed');
      expect(outcome.failureReason).toBe('DOC_NOT_ALLOWED');
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('expõe failure para arquivo grande', async () => {
      mediaService.downloadInboundDocument.mockRejectedValue(
        new WhatsappMediaValidationError('big', 'DOC_TOO_LARGE'),
      );

      const outcome = await service.stageInboundDocument({
        media: {
          url: 'https://api.twilio.com/media/y',
          contentType: 'application/pdf',
        },
        phone: '5511999990000',
        messageSid: 'SM-3',
      });

      expect(outcome.status).toBe('failed');
      expect(outcome.failureReason).toBe('DOC_TOO_LARGE');
    });
  });

  describe('clearPending / deleteStoragePath', () => {
    it('apaga corretamente do in-memory store', async () => {
      mediaService.downloadInboundDocument.mockResolvedValue({
        buffer: Buffer.from('hi'),
        mimeType: 'image/jpeg',
        sizeBytes: 2,
        fileName: 'whatsapp-doc-1.jpg',
        kind: 'image',
      });
      storageService.uploadBuffer.mockResolvedValue('whatsapp-tmp/abc.jpg');

      await service.stageInboundDocument({
        media: { url: 'https://api.twilio.com/m/1', contentType: 'image/jpeg' },
        phone: '5511777',
        messageSid: 'SM-clear',
      });

      expect(await service.getPending('5511777')).not.toBeNull();
      await service.clearPending('5511777');
      expect(await service.getPending('5511777')).toBeNull();
    });

    it('deleteStoragePath invoca storage.delete', async () => {
      await service.deleteStoragePath('whatsapp-tmp/x.pdf');
      expect(storageService.delete).toHaveBeenCalledWith('whatsapp-tmp/x.pdf');
    });
  });
});
