import { BadRequestException } from '@nestjs/common';

jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: (buf: Buffer) =>
      Promise.resolve(
        buf.subarray(0, 4).toString() === '%PDF'
          ? { ext: 'pdf', mime: 'application/pdf' }
          : undefined,
      ),
  }),
  { virtual: true },
);
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

  describe('create — limite de tamanho por pasta', () => {
    const arquivo = (bytes: number): Express.Multer.File =>
      ({
        originalname: 'exame.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(bytes - 5)]),
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
          arquivo(600 * 1024),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita arquivo dentro do limite da pasta (40 MB em documents)', async () => {
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
          arquivo(40 * 1024 * 1024),
        ),
      ).resolves.toMatchObject({ id: 'doc-1' });
      expect(storageService.create).toHaveBeenCalled();
    });
  });

  describe('create — tipo do arquivo', () => {
    const dados = {
      surgeryRequestId: 'sr-1',
      key: 'exame',
      name: 'exame',
      folder: STORAGE_FOLDERS.DOCUMENTS,
    };
    let storageService: { create: jest.Mock; getSignedUrl: jest.Mock };
    let servico: DocumentsService;

    beforeEach(() => {
      storageService = {
        create: jest.fn().mockResolvedValue('documents/owner-1/exame.pdf'),
        getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
      };
      servico = new DocumentsService(
        null as any,
        storageService as any,
        documentRepository as any,
        { validateAndFetch: jest.fn() } as any,
      );
      documentRepository.create.mockResolvedValue(makeDoc());
    });

    it('recusa HTML e não grava nada', async () => {
      await expect(
        servico.create(dados as any, 'user-1', 'owner-1', {
          originalname: 'x.html',
          mimetype: 'text/html',
          buffer: Buffer.from('<script>alert(1)</script>'),
          size: 25,
        } as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.create).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it('recusa HTML declarado como PDF (magic bytes)', async () => {
      await expect(
        servico.create(dados as any, 'user-1', 'owner-1', {
          originalname: 'x.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('<html></html>'),
          size: 13,
        } as Express.Multer.File),
      ).rejects.toThrow('Tipo de arquivo inválido');
      expect(storageService.create).not.toHaveBeenCalled();
    });

    it('grava com o tipo detectado, não o declarado pelo cliente', async () => {
      await servico.create(dados, 'user-1', 'owner-1', {
        originalname: 'exame.bin',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from('%PDF-1.7'),
        size: 8,
      } as Express.Multer.File);
      expect(storageService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mimetype: 'application/pdf',
          originalname: 'exame.pdf',
        }),
        'documents',
        'owner-1',
      );
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
