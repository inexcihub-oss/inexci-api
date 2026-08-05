import { ForbiddenException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService.create — posse da SC em rota multipart', () => {
  it('recusa anexo em SC de outra clinica', async () => {
    const accessValidator = {
      validateAndFetch: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Acesso negado')),
    };
    const storage = { create: jest.fn(), getSignedUrl: jest.fn() };
    const repo = { create: jest.fn() };

    const service = new DocumentsService(
      repo as any,
      storage as any,
      {} as any,
      accessValidator as any,
    );

    await expect(
      service.create(
        {
          surgeryRequestId: 'sc-de-outra-clinica',
          key: 'k',
          name: 'n',
          folder: 'documents',
        } as any,
        'atacante',
        'owner-a',
        { buffer: Buffer.from('x'), mimetype: 'application/pdf' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);

    // O arquivo nao pode nem chegar ao storage.
    expect(storage.create).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
