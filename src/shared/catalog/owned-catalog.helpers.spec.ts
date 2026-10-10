import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  bulkDeleteOwned,
  createOrRestoreByName,
  findOwnedOrFail,
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
          repository: repo as never,
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

  it('escapeLikePattern neutraliza curingas do ILIKE', () => {
    expect(escapeLikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});
