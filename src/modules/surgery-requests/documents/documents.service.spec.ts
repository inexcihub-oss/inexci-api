import { DocumentsService } from './documents.service';
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
    );
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
