import { ForbiddenException } from '@nestjs/common';
import { UploadService } from './upload.service';
import { StorageService } from '../../shared/storage/storage.service';
import { DocumentRepository } from '../../database/repositories/document.repository';

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
});
