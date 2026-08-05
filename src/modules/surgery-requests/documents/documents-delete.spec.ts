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

  it('nao apaga no R2 quando o `key` informado nao casa com o do documento', async () => {
    // O `key` errado fazia o DELETE no banco nao afetar linha nenhuma, mas o
    // storage apagava pela `uri` do documento carregado: registro vivo,
    // arquivo perdido.
    const storage = { delete: jest.fn() };
    const repo = {
      findOneSimple: jest.fn().mockResolvedValue({
        id: 'doc-1',
        key: 'key-correta.pdf',
        uri: 'documents/owner-1/laudo.pdf',
      }),
    };
    const documentTypeormRepo = { delete: jest.fn() };
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
        id: 'doc-1',
        key: 'key-totalmente-errado.pdf',
        surgeryRequestId: 'sc-1',
      } as any),
    ).rejects.toThrow(NotFoundException);

    expect(documentTypeormRepo.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('nao apaga no R2 quando o DELETE no banco nao afeta linha nenhuma', async () => {
    const storage = { delete: jest.fn() };
    const repo = {
      findOneSimple: jest.fn().mockResolvedValue({
        id: 'doc-1',
        key: 'key-correta.pdf',
        uri: 'documents/owner-1/laudo.pdf',
      }),
    };
    // Corrida: outra requisicao removeu a linha entre o SELECT e o DELETE.
    const documentTypeormRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
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
        id: 'doc-1',
        key: 'key-correta.pdf',
        surgeryRequestId: 'sc-1',
      } as any),
    ).rejects.toThrow(NotFoundException);

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('apaga no R2 quando o `key` casa e a linha foi removida', async () => {
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const repo = {
      findOneSimple: jest.fn().mockResolvedValue({
        id: 'doc-1',
        key: 'key-correta.pdf',
        uri: 'documents/owner-1/laudo.pdf',
      }),
    };
    const documentTypeormRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
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

    await service.delete({
      id: 'doc-1',
      key: 'key-correta.pdf',
      surgeryRequestId: 'sc-1',
    } as any);

    expect(storage.delete).toHaveBeenCalledWith('documents/owner-1/laudo.pdf');
  });
});
