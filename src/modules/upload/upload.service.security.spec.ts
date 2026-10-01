import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UploadService } from './upload.service';
import { StorageService } from '../../shared/storage/storage.service';
import { DocumentRepository } from '../../database/repositories/document.repository';

// `file-type` é ESM puro e o Jest (CommonJS) não o resolve; o que se testa aqui
// é a regra de pasta/tenant, não a detecção de magic bytes.
jest.mock(
  'file-type',
  () => ({ fileTypeFromBuffer: jest.fn().mockResolvedValue(undefined) }),
  { virtual: true },
);

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
    const PNG = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000',
      'hex',
    );
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
  });
});
