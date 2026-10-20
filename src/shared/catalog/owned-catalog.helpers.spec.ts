import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  bulkDeleteOwned,
  createOrRestoreByName,
  findOwnedOrFail,
  updateWithUniqueName,
} from './owned-catalog.helpers';
import { escapeLikePattern } from 'src/database/repositories/owned-catalog.repository';

describe('owned-catalog helpers', () => {
  const accessControl = { assertSameOwner: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  describe('findOwnedOrFail', () => {
    it('lança 404 quando não existe', async () => {
      const repo = { findOne: jest.fn().mockResolvedValue(null) };
      await expect(
        findOwnedOrFail(
          repo as never,
          accessControl as never,
          'x',
          'u',
          'Nada',
        ),
      ).rejects.toThrow(new NotFoundException('Nada'));
    });

    it('confere a conta do registro', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue({ id: 'h1', ownerId: 'o1' }),
      };
      await findOwnedOrFail(
        repo as never,
        accessControl as never,
        'h1',
        'u',
        '',
      );
      expect(accessControl.assertSameOwner).toHaveBeenCalledWith('u', 'o1');
    });
  });

  describe('bulkDeleteOwned', () => {
    it('não apaga nada se algum id não for da conta', async () => {
      const repo = {
        findMany: jest.fn().mockResolvedValue([{ id: 'a', ownerId: 'o' }]),
        bulkSoftDelete: jest.fn(),
      };
      await expect(
        bulkDeleteOwned({
          repository: repo,
          ids: ['a', 'b'],
          ownerId: 'o',
          notFoundMessage: 'faltou',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.bulkSoftDelete).not.toHaveBeenCalled();
    });

    it('deduplica, roda o guard e apaga em lote', async () => {
      const registros = [
        { id: 'a', ownerId: 'o' },
        { id: 'b', ownerId: 'o' },
      ];
      const repo = {
        findMany: jest.fn().mockResolvedValue(registros),
        bulkSoftDelete: jest.fn(),
      };
      const guard = jest.fn();

      await expect(
        bulkDeleteOwned({
          repository: repo as never,
          ids: ['a', 'b', 'a'],
          ownerId: 'o',
          notFoundMessage: '',
          guard,
        }),
      ).resolves.toEqual({ deleted: 2 });
      expect(guard).toHaveBeenCalledTimes(2);
      expect(repo.bulkSoftDelete).toHaveBeenCalledWith(['a', 'b']);
    });
  });

  describe('createOrRestoreByName', () => {
    const buildRepo = (existente: unknown) => ({
      findByNameIncludingDeleted: jest.fn().mockResolvedValue(existente),
      restore: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'velho', name: 'Santa Casa' }),
      create: jest.fn().mockResolvedValue({ id: 'novo' }),
    });

    it('cria quando não há homônimo', async () => {
      const repo = buildRepo(null);
      await createOrRestoreByName({
        repository: repo as never,
        ownerId: 'o',
        data: { name: 'Santa Casa', active: true } as never,
        conflictMessage: (n) => n,
      });
      expect(repo.create).toHaveBeenCalledWith({
        name: 'Santa Casa',
        active: true,
        ownerId: 'o',
      });
    });

    it('409 quando o homônimo está ativo', async () => {
      const repo = buildRepo({ id: 'x', deletedAt: null });
      await expect(
        createOrRestoreByName({
          repository: repo as never,
          ownerId: 'o',
          data: { name: '  Santa Casa ' } as never,
          conflictMessage: (n) => `dup ${n}`,
        }),
      ).rejects.toThrow(new ConflictException('dup Santa Casa'));
    });

    it('restaura o homônimo excluído em vez de duplicar (hospital/convênio)', async () => {
      const repo = buildRepo({ id: 'velho', deletedAt: new Date() });
      const result = await createOrRestoreByName({
        repository: repo as never,
        ownerId: 'o',
        data: { name: 'Santa Casa', active: true } as never,
        conflictMessage: (n) => n,
      });
      expect(repo.restore).toHaveBeenCalledWith('velho');
      expect(repo.update).toHaveBeenCalledWith('velho', {
        name: 'Santa Casa',
        active: true,
      });
      expect(repo.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'velho', name: 'Santa Casa' });
    });
  });

  describe('corrida com o índice único de nome', () => {
    const INDICE = 'uq_hospitals_owner_name_active';
    const violacao = (constraint: string) =>
      Object.assign(new Error('duplicate key'), {
        driverError: { code: '23505', constraint },
      });

    it('create que perde a corrida vira 409 em vez de 500', async () => {
      const repo = {
        findByNameIncludingDeleted: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(violacao(INDICE)),
      };
      await expect(
        createOrRestoreByName({
          repository: repo as never,
          ownerId: 'o',
          data: { name: ' Santa Casa ' } as never,
          conflictMessage: (n) => `Já existe um hospital com o nome "${n}"`,
          uniqueIndex: INDICE,
        }),
      ).rejects.toThrow(
        new ConflictException('Já existe um hospital com o nome "Santa Casa"'),
      );
    });

    it('restore que colide com um homônimo vivo vira 409', async () => {
      const repo = {
        findByNameIncludingDeleted: jest
          .fn()
          .mockResolvedValue({ id: 'velho', deletedAt: new Date() }),
        restore: jest.fn().mockRejectedValue(violacao(INDICE)),
        update: jest.fn(),
      };
      await expect(
        createOrRestoreByName({
          repository: repo as never,
          ownerId: 'o',
          data: { name: 'Santa Casa' } as never,
          conflictMessage: (n) => `dup ${n}`,
          uniqueIndex: INDICE,
        }),
      ).rejects.toThrow(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('violação de outro índice não é mascarada', async () => {
      const erro = violacao('outro_indice');
      const repo = {
        findByNameIncludingDeleted: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(erro),
      };
      await expect(
        createOrRestoreByName({
          repository: repo as never,
          ownerId: 'o',
          data: { name: 'X' } as never,
          conflictMessage: (n) => n,
          uniqueIndex: INDICE,
        }),
      ).rejects.toBe(erro);
    });

    it('sem índice informado, a violação sobe como veio', async () => {
      const erro = violacao(INDICE);
      const repo = {
        findByNameIncludingDeleted: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(erro),
      };
      await expect(
        createOrRestoreByName({
          repository: repo as never,
          ownerId: 'o',
          data: { name: 'X' } as never,
          conflictMessage: (n) => n,
        }),
      ).rejects.toBe(erro);
    });

    it('update que renomeia para um nome já usado devolve 409', async () => {
      const repo = { update: jest.fn().mockRejectedValue(violacao(INDICE)) };
      await expect(
        updateWithUniqueName({
          repository: repo,
          id: 'h1',
          data: { name: ' Santa Casa ' } as never,
          uniqueIndex: INDICE,
          conflictMessage: (n) => `Já existe um hospital com o nome "${n}"`,
        }),
      ).rejects.toThrow(
        new ConflictException('Já existe um hospital com o nome "Santa Casa"'),
      );
    });

    it('update sem colisão devolve o registro atualizado', async () => {
      const repo = {
        update: jest.fn().mockResolvedValue({ id: 'h1', name: 'Nova' }),
      };
      await expect(
        updateWithUniqueName({
          repository: repo,
          id: 'h1',
          data: { name: 'Nova' } as never,
          uniqueIndex: INDICE,
          conflictMessage: (n) => n,
        }),
      ).resolves.toEqual({ id: 'h1', name: 'Nova' });
      expect(repo.update).toHaveBeenCalledWith('h1', { name: 'Nova' });
    });

    it('update com outro erro não vira 409', async () => {
      const erro = new Error('boom');
      const repo = { update: jest.fn().mockRejectedValue(erro) };
      await expect(
        updateWithUniqueName({
          repository: repo,
          id: 'h1',
          data: { name: 'Nova' } as never,
          uniqueIndex: INDICE,
          conflictMessage: (n) => n,
        }),
      ).rejects.toBe(erro);
    });
  });

  it('escapeLikePattern neutraliza curingas do ILIKE', () => {
    expect(escapeLikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});
