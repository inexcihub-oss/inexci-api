import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UploadService } from './upload.service';
import { StorageService } from '../../shared/storage/storage.service';
import { DocumentRepository } from '../../database/repositories/document.repository';
import { sharp } from '../../shared/storage/foto-paciente';

const detectarTipo = async (buf: Buffer) => {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a'))
    return { ext: 'png', mime: 'image/png' };
  if (hex.startsWith('ffd8ff')) return { ext: 'jpg', mime: 'image/jpeg' };
  if (hex.startsWith('47494638')) return { ext: 'gif', mime: 'image/gif' };
  if (buf.subarray(0, 4).toString() === '%PDF')
    return { ext: 'pdf', mime: 'application/pdf' };
  if (
    buf.subarray(0, 4).toString() === 'RIFF' &&
    buf.subarray(8, 12).toString() === 'WEBP'
  )
    return { ext: 'webp', mime: 'image/webp' };
  return undefined;
};
const fileTypeFromBuffer = jest.fn(detectarTipo);
jest.mock('file-type', () => ({ fileTypeFromBuffer }), { virtual: true });

describe('UploadService — IDOR (VULN-03)', () => {
  let service: UploadService;
  let mockDocumentRepository: Partial<DocumentRepository>;
  let mockStorageService: Partial<StorageService>;

  beforeEach(() => {
    mockDocumentRepository = {
      existsByUriAndOwner: jest.fn(),
    };

    mockStorageService = {
      getSignedUrl: jest.fn().mockResolvedValue('https://example.com/signed'),
    };

    service = new UploadService(
      mockStorageService as StorageService,
      mockDocumentRepository as DocumentRepository,
    );
  });

  describe('pastas com escopo de tenant (documents, post-surgical, report)', () => {
    it('deve lançar ForbiddenException se arquivo não pertence ao tenant', async () => {
      (
        mockDocumentRepository.existsByUriAndOwner as jest.Mock
      ).mockResolvedValue(false);

      await expect(
        service.getSignedUrl(
          'documents/arquivo-de-outro-tenant.pdf',
          'owner-a',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException se ownerId for null', async () => {
      await expect(
        service.getSignedUrl('documents/arquivo.pdf', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve gerar URL se arquivo pertence ao tenant', async () => {
      (
        mockDocumentRepository.existsByUriAndOwner as jest.Mock
      ).mockResolvedValue(true);

      const result = await service.getSignedUrl(
        'documents/meu-arquivo.pdf',
        'owner-a',
      );

      expect(result.url).toBe('https://example.com/signed');
    });

    it('deve verificar post-surgical e report também', async () => {
      (
        mockDocumentRepository.existsByUriAndOwner as jest.Mock
      ).mockResolvedValue(false);

      await expect(
        service.getSignedUrl('post-surgical/laudo.pdf', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.getSignedUrl('report/imagem.png', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('pastas públicas (avatars, headers)', () => {
    it('deve gerar URL sem verificação de tenant para avatars', async () => {
      const result = await service.getSignedUrl('avatars/photo.png', 'owner-a');

      expect(mockDocumentRepository.existsByUriAndOwner).not.toHaveBeenCalled();
      expect(result.url).toBe('https://example.com/signed');
    });

    it('deve gerar URL sem verificação de tenant para headers', async () => {
      const result = await service.getSignedUrl('headers/logo.png', 'owner-a');

      expect(mockDocumentRepository.existsByUriAndOwner).not.toHaveBeenCalled();
      expect(result.url).toBe('https://example.com/signed');
    });
  });

  describe('pastas sem registro em documents (pdfs, signatures, stamps)', () => {
    it('recusa quando o ownerId do caminho e de outro tenant', async () => {
      await expect(
        service.getSignedUrl('pdfs/owner-b/laudo.pdf', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('recusa assinatura de medico de outra clinica', async () => {
      await expect(
        service.getSignedUrl('signatures/owner-b/assinatura.png', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permite quando o ownerId do caminho e o do proprio usuario', async () => {
      await expect(
        service.getSignedUrl('pdfs/owner-a/laudo.pdf', 'owner-a'),
      ).resolves.toEqual({ url: 'https://example.com/signed' });
    });
  });
  describe('fotos de paciente (patient-photos)', () => {
    let PNG: Buffer;
    beforeAll(async () => {
      PNG = await sharp({
        create: {
          width: 1600,
          height: 1200,
          channels: 3,
          background: '#a0a0a0',
        },
      })
        .png()
        .toBuffer();
    });
    const arquivo = (mimetype: string, buffer: Buffer = PNG) =>
      ({
        originalname: 'foto.png',
        mimetype,
        buffer,
      }) as Express.Multer.File;

    beforeEach(() => {
      mockStorageService.create = jest
        .fn()
        .mockResolvedValue('patient-photos/owner-a/uuid-foto.png');
    });

    it('não é pasta pública: recusa foto de paciente de outro tenant', async () => {
      await expect(
        service.getSignedUrl('patient-photos/owner-b/foto.png', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockStorageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('gera URL para foto do próprio tenant', async () => {
      await expect(
        service.getSignedUrl('patient-photos/owner-a/foto.png', 'owner-a'),
      ).resolves.toEqual({ url: 'https://example.com/signed' });
    });

    it('grava a foto com o ownerId no caminho', async () => {
      const result = await service.uploadFile(
        arquivo('image/png'),
        'patient-photos',
        'owner-a',
      );

      expect(mockStorageService.create).toHaveBeenCalledWith(
        expect.anything(),
        'patient-photos',
        'owner-a',
      );
      expect(result.path).toBe('patient-photos/owner-a/uuid-foto.png');
    });

    it('converte a foto para WebP de até 800 px antes de gravar', async () => {
      await service.uploadFile(
        arquivo('image/png'),
        'patient-photos',
        'owner-a',
      );

      const gravado = (mockStorageService.create as jest.Mock).mock.calls[0][0];
      expect(gravado).toMatchObject({
        mimetype: 'image/webp',
        originalname: 'foto.webp',
      });
      const meta = await sharp(gravado.buffer).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'webp',
        800,
        600,
      ]);
      expect(gravado.size).toBe(gravado.buffer.length);
    });

    it('imagem corrompida é recusada sem gravar nada', async () => {
      await expect(
        service.uploadFile(
          arquivo('image/png', Buffer.from('89504e470d0a1a0a', 'hex')),
          'patient-photos',
          'owner-a',
        ),
      ).rejects.toThrow('Não foi possível ler a imagem enviada.');
      expect(mockStorageService.create).not.toHaveBeenCalled();
    });

    it('recusa PDF na pasta de foto de paciente', async () => {
      await expect(
        service.uploadFile(
          arquivo('application/pdf', Buffer.from('%PDF-1.4')),
          'patient-photos',
          'owner-a',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.create).not.toHaveBeenCalled();
    });

    const SVG = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );

    it('recusa SVG declarado como PNG (file-type não detecta nada)', async () => {
      await expect(
        service.uploadFile(
          arquivo('image/png', SVG),
          'patient-photos',
          'owner-a',
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
      expect(mockStorageService.create).not.toHaveBeenCalled();
    });

    it('se a detecção errar, o sharp ainda recusa SVG com 400', async () => {
      fileTypeFromBuffer.mockResolvedValueOnce({
        ext: 'png',
        mime: 'image/png',
      });
      await expect(
        service.uploadFile(
          arquivo('image/png', SVG),
          'patient-photos',
          'owner-a',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.create).not.toHaveBeenCalled();
    });

    it('recusa GIF disfarçado de PNG', async () => {
      const gif = await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#000' },
      })
        .gif()
        .toBuffer();
      await expect(
        service.uploadFile(
          arquivo('image/png', gif),
          'patient-photos',
          'owner-a',
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });

    it('bomba de pixels vira 400 sem gravar nada', async () => {
      const enorme = await sharp({
        create: { width: 6500, height: 6500, channels: 3, background: '#fff' },
      })
        .png()
        .toBuffer();
      expect(enorme.length).toBeLessThan(2 * 1024 * 1024);
      await expect(
        service.uploadFile(
          arquivo('image/png', enorme),
          'patient-photos',
          'owner-a',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.create).not.toHaveBeenCalled();
    });

    it('aceita JPEG declarado como image/jpg (MIME não oficial dos navegadores)', async () => {
      const jpeg = await sharp({
        create: { width: 100, height: 100, channels: 3, background: '#123' },
      })
        .jpeg()
        .toBuffer();
      await service.uploadFile(
        arquivo('image/jpg', jpeg),
        'patient-photos',
        'owner-a',
      );
      expect(mockStorageService.create).toHaveBeenCalled();
    });
  });

  describe('magic bytes nas demais pastas', () => {
    const arquivo = (mimetype: string, buffer: Buffer, originalname = 'x') =>
      ({ originalname, mimetype, buffer }) as Express.Multer.File;

    beforeEach(() => {
      mockStorageService.create = jest
        .fn()
        .mockResolvedValue('documents/owner-a/uuid-x');
    });

    it('imagem sem assinatura reconhecível é recusada também fora de patient-photos', async () => {
      await expect(
        service.uploadFile(
          arquivo('image/png', Buffer.from('<svg/>')),
          'avatars',
          'owner-a',
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });

    it('PDF sem assinatura %PDF é recusado', async () => {
      await expect(
        service.uploadFile(
          arquivo('application/pdf', Buffer.from('<html></html>')),
          'documents',
          'owner-a',
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
    });

    it('PDF de verdade continua passando', async () => {
      await expect(
        service.uploadFile(
          arquivo('application/pdf', Buffer.from('%PDF-1.4\n%%EOF')),
          'documents',
          'owner-a',
        ),
      ).resolves.toMatchObject({ path: 'documents/owner-a/uuid-x' });
    });

    it('áudio não detectado segue aceito (file-type tem variantes de MIME)', async () => {
      await expect(
        service.uploadFile(
          arquivo('audio/mpeg', Buffer.from('qualquer')),
          'documents',
          'owner-a',
        ),
      ).resolves.toMatchObject({ path: 'documents/owner-a/uuid-x' });
    });
  });
});
