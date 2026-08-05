import { BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import { Document } from 'src/database/entities/document.entity';

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    surgeryRequestId: 'sr-1',
    createdById: 'user-1',
    key: 'documents-key/doc.pdf',
    name: 'Laudo.pdf',
    type: 'medical_report',
    uri: 'documents/sr-1/doc.pdf',
    ...overrides,
  } as Document;
}

describe('DocumentsService', () => {
  let service: DocumentsService;
  let documentRepository: {
    create: jest.Mock;
    findOneSimple: jest.Mock;
  };

  beforeEach(() => {
    documentRepository = {
      create: jest.fn(),
      findOneSimple: jest.fn(),
    };

    service = new DocumentsService(
      null as any,
      null as any,
      documentRepository as any,
      { validateAndFetch: jest.fn() } as any,
    );
  });

  // O limite real do upload é `STORAGE_FOLDER_SIZE_LIMITS` (config): o
  // `FileInterceptor` é só um corte grosso, e antes ele era menor (5 MB) que o
  // teto da config (10 MB) — o limite configurado era inalcançável.
  describe('create — limite de tamanho por pasta', () => {
    const arquivo = (bytes: number): Express.Multer.File =>
      ({
        originalname: 'exame.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(bytes),
        size: bytes,
      }) as Express.Multer.File;

    const dados = (folder: string) => ({
      surgeryRequestId: 'sr-1',
      key: 'exame',
      name: 'exame.pdf',
      folder,
    });

    it('recusa arquivo acima do limite da pasta', async () => {
      await expect(
        service.create(
          dados(STORAGE_FOLDERS.SIGNATURES) as any,
          'user-1',
          'owner-1',
          arquivo(600 * 1024), // limite de signatures: 500 KB
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita arquivo dentro do limite da pasta (6 MB em documents)', async () => {
      const storageService = {
        create: jest.fn().mockResolvedValue('documents/owner-1/exame.pdf'),
        getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
      };
      const servico = new DocumentsService(
        null as any,
        storageService as any,
        documentRepository as any,
        { validateAndFetch: jest.fn() } as any,
      );
      documentRepository.create.mockResolvedValue(makeDoc());

      await expect(
        servico.create(
          dados(STORAGE_FOLDERS.DOCUMENTS) as any,
          'user-1',
          'owner-1',
          arquivo(6 * 1024 * 1024), // acima dos 5 MB antigos, dentro dos 10 MB da config
        ),
      ).resolves.toMatchObject({ id: 'doc-1' });
      expect(storageService.create).toHaveBeenCalled();
    });
  });

  describe('createFromPath', () => {
    it('cria documento com todos os campos e retorna o registro', async () => {
      const expected = makeDoc();
      documentRepository.create.mockResolvedValue(expected);

      const result = await service.createFromPath({
        surgeryRequestId: 'sr-1',
        storagePath: 'documents/sr-1/doc.pdf',
        type: 'medical_report',
        name: 'Laudo.pdf',
        key: 'documents-key/doc.pdf',
        contentType: 'application/pdf',
        createdById: 'user-1',
      });

      expect(documentRepository.create).toHaveBeenCalledWith({
        surgeryRequestId: 'sr-1',
        createdById: 'user-1',
        key: 'documents-key/doc.pdf',
        name: 'Laudo.pdf',
        type: 'medical_report',
        uri: 'documents/sr-1/doc.pdf',
      });
      expect(result).toBe(expected);
    });

    it('propaga exceção quando documentRepository.create lança erro (ex.: FK inválida)', async () => {
      documentRepository.create.mockRejectedValue(
        new Error('violação de chave estrangeira'),
      );

      await expect(
        service.createFromPath({
          surgeryRequestId: 'sr-invalido',
          storagePath: 'documents/sr-invalido/doc.pdf',
          type: 'medical_report',
          name: 'Laudo.pdf',
          key: 'key',
          contentType: 'application/pdf',
          createdById: 'user-1',
        }),
      ).rejects.toThrow('violação de chave estrangeira');
    });

    it('persiste o type informado sem alteração (custom type)', async () => {
      const customType = 'authorization_guide';
      const expected = makeDoc({ type: customType });
      documentRepository.create.mockResolvedValue(expected);

      const result = await service.createFromPath({
        surgeryRequestId: 'sr-1',
        storagePath: 'path/file.pdf',
        type: customType,
        name: 'Guia.pdf',
        key: 'key',
        contentType: 'application/pdf',
        createdById: 'user-1',
      });

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: customType }),
      );
      expect(result.type).toBe(customType);
    });
  });
});
