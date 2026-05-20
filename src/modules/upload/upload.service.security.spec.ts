// Mock Supabase para evitar validação de URL no nível do módulo
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: jest.fn() },
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(),
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://example.com/signed' },
          error: null,
        }),
      })),
    },
  })),
}));

import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadService } from './upload.service';
import { DocumentRepository } from '../../database/repositories/document.repository';

describe('UploadService — IDOR (VULN-03)', () => {
  let service: UploadService;
  let mockDocumentRepository: Partial<DocumentRepository>;
  let mockSupabase: any;

  beforeEach(() => {
    mockDocumentRepository = {
      existsByUriAndOwner: jest.fn(),
    };

    mockSupabase = {
      storage: {
        from: jest.fn(() => ({
          createSignedUrl: jest.fn().mockResolvedValue({
            data: { signedUrl: 'https://example.com/signed' },
            error: null,
          }),
        })),
      },
    };

    service = new UploadService(
      mockSupabase,
      { get: jest.fn().mockReturnValue('inexci-storage') } as unknown as ConfigService,
      mockDocumentRepository as DocumentRepository,
    );
  });

  describe('pastas com escopo de tenant (documents, post-surgical, report)', () => {
    it('deve lançar ForbiddenException se arquivo não pertence ao tenant', async () => {
      (mockDocumentRepository.existsByUriAndOwner as jest.Mock).mockResolvedValue(
        false,
      );

      await expect(
        service.getSignedUrl('documents/arquivo-de-outro-tenant.pdf', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException se ownerId for null', async () => {
      await expect(
        service.getSignedUrl('documents/arquivo.pdf', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve gerar URL se arquivo pertence ao tenant', async () => {
      (mockDocumentRepository.existsByUriAndOwner as jest.Mock).mockResolvedValue(
        true,
      );

      const result = await service.getSignedUrl(
        'documents/meu-arquivo.pdf',
        'owner-a',
      );

      expect(result.url).toBe('https://example.com/signed');
    });

    it('deve verificar post-surgical e report também', async () => {
      (mockDocumentRepository.existsByUriAndOwner as jest.Mock).mockResolvedValue(
        false,
      );

      await expect(
        service.getSignedUrl('post-surgical/laudo.pdf', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.getSignedUrl('report/imagem.png', 'owner-a'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('pastas pessoais (avatars, signatures, headers)', () => {
    it('deve gerar URL sem verificação de tenant para avatars', async () => {
      const result = await service.getSignedUrl(
        'avatars/photo.png',
        'owner-a',
      );

      expect(mockDocumentRepository.existsByUriAndOwner).not.toHaveBeenCalled();
      expect(result.url).toBe('https://example.com/signed');
    });

    it('deve gerar URL sem verificação de tenant para signatures', async () => {
      const result = await service.getSignedUrl(
        'signatures/assinatura.png',
        'owner-a',
      );

      expect(mockDocumentRepository.existsByUriAndOwner).not.toHaveBeenCalled();
      expect(result.url).toBe('https://example.com/signed');
    });
  });
});
