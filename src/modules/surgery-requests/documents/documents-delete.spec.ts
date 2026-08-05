import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService.delete — exclusao cross-tenant no storage', () => {
  it('nao apaga no R2 quando o documento nao pertence a SC informada', async () => {
    const victimDocument = {
      id: 'documento-da-clinica-b',
      uri: 'clinica-b/laudo.pdf',
    };

    const storage = { delete: jest.fn() };
    // Busca escopada: com o filtro correto (id + surgeryRequestId), o
    // documento da vitima (de outra SC) nao e achado. Sem o filtro por
    // surgeryRequestId, o mock simula o bug atual e "acha" o documento.
    const repo = {
      findOneSimple: jest.fn((where: any) =>
        where?.surgeryRequestId
          ? Promise.resolve(null)
          : Promise.resolve(victimDocument),
      ),
    };
    const documentTypeormRepo = { delete: jest.fn().mockResolvedValue({}) };
    const manager = {
      getRepository: jest.fn().mockReturnValue(documentTypeormRepo),
    };
    const dataSource = { transaction: jest.fn((fn: any) => fn(manager)) };

    const service = new DocumentsService(
      dataSource as any,
      storage as any,
      repo as any,
      {} as any,
    );

    await expect(
      service.delete({
        id: 'documento-da-clinica-b',
        key: 'qualquer',
        surgeryRequestId: 'sc-propria-da-clinica-a',
      } as any),
    ).rejects.toThrow(NotFoundException);

    expect(storage.delete).not.toHaveBeenCalled();
  });
});
