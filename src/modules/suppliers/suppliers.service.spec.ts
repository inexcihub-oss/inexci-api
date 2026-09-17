import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;

  const mockSupplierRepository = {
    findMany: jest.fn(),
    total: jest.fn(),
    findOne: jest.fn(),
    findByNameIncludingDeleted: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    bulkSoftDelete: jest.fn(),
    restore: jest.fn(),
  };

  const mockAccessControlService = {
    getOwnerId: jest.fn(),
    assertSameOwner: jest.fn(),
  };

  const mockOpmeItemRepository = {
    findSuppliedSurgeryRequestsBySupplierId: jest.fn(),
  };

  const ownerId = 'owner-1';
  const userId = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessControlService.getOwnerId.mockResolvedValue(ownerId);
    mockAccessControlService.assertSameOwner.mockResolvedValue(undefined);

    service = new SuppliersService(
      mockSupplierRepository as any,
      mockAccessControlService as any,
      mockOpmeItemRepository as any,
    );
  });

  /**
   * "Outro" é o fornecedor genérico da conta — a resposta para "nenhum dos
   * cadastrados", não um cadastro. Ele aparece nos itens OPME, mas não é do
   * usuário: deixá-lo no catálogo o convida a editar ou excluir uma linha que
   * a plataforma usa como conceito.
   */
  describe('opção genérica "Outro"', () => {
    it('fica fora da listagem do catálogo', async () => {
      mockSupplierRepository.total.mockResolvedValue(0);
      mockSupplierRepository.findMany.mockResolvedValue([]);

      await service.findAll({} as never, userId);

      expect(mockSupplierRepository.findMany.mock.calls[0][0]).toMatchObject({
        ownerId,
        isGeneric: false,
      });
      expect(mockSupplierRepository.total.mock.calls[0][0]).toMatchObject({
        isGeneric: false,
      });
    });

    it('não pode ser editado', async () => {
      mockSupplierRepository.findOne.mockResolvedValue({
        id: 'gen-1',
        ownerId,
        isGeneric: true,
      });

      await expect(
        service.update('gen-1', { name: 'Meu Fornecedor' } as never, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockSupplierRepository.update).not.toHaveBeenCalled();
    });

    it('não pode ser excluído', async () => {
      mockSupplierRepository.findOne.mockResolvedValue({
        id: 'gen-1',
        ownerId,
        isGeneric: true,
      });

      await expect(service.delete('gen-1', userId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockSupplierRepository.softDelete).not.toHaveBeenCalled();
    });

    it('não pode ser excluído em lote junto com cadastros de verdade', async () => {
      mockSupplierRepository.findMany.mockResolvedValue([
        { id: 'real-1', ownerId, isGeneric: false },
        { id: 'gen-1', ownerId, isGeneric: true },
      ]);

      await expect(
        service.bulkDelete(['real-1', 'gen-1'], userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockSupplierRepository.bulkSoftDelete).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deve aplicar soft delete em vez de remover o registro', async () => {
      mockSupplierRepository.findOne.mockResolvedValue({
        id: 'sup-1',
        ownerId,
      });

      await service.delete('sup-1', userId);

      expect(mockSupplierRepository.softDelete).toHaveBeenCalledWith('sup-1');
      expect(mockAccessControlService.assertSameOwner).toHaveBeenCalledWith(
        userId,
        ownerId,
      );
    });

    it('deve lançar NotFoundException se fornecedor não existir', async () => {
      mockSupplierRepository.findOne.mockResolvedValue(null);

      await expect(service.delete('sup-1', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkDelete', () => {
    it('deve aplicar soft delete em lote', async () => {
      mockSupplierRepository.findMany.mockResolvedValue([
        { id: 'sup-1', ownerId },
        { id: 'sup-2', ownerId },
      ]);

      const result = await service.bulkDelete(['sup-1', 'sup-2'], userId);

      expect(mockSupplierRepository.bulkSoftDelete).toHaveBeenCalledWith([
        'sup-1',
        'sup-2',
      ]);
      expect(result).toEqual({ deleted: 2 });
    });
  });

  describe('create', () => {
    it('deve restaurar fornecedor soft-deleted com o mesmo nome', async () => {
      mockSupplierRepository.findByNameIncludingDeleted.mockResolvedValue({
        id: 'sup-1',
        name: 'Fornecedor A',
        deletedAt: new Date(),
      });
      mockSupplierRepository.update.mockResolvedValue({
        id: 'sup-1',
        name: 'Fornecedor A',
      });

      const result = await service.create({ name: 'Fornecedor A' }, userId);

      expect(mockSupplierRepository.restore).toHaveBeenCalledWith('sup-1');
      expect(mockSupplierRepository.update).toHaveBeenCalledWith('sup-1', {
        name: 'Fornecedor A',
      });
      expect(mockSupplierRepository.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'sup-1', name: 'Fornecedor A' });
    });

    it('deve lançar ConflictException se já existir fornecedor ativo', async () => {
      mockSupplierRepository.findByNameIncludingDeleted.mockResolvedValue({
        id: 'sup-1',
        name: 'Fornecedor A',
        deletedAt: null,
      });

      await expect(
        service.create({ name: 'Fornecedor A' }, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('deve lançar ForbiddenException se usuário não tiver clínica', async () => {
      mockAccessControlService.getOwnerId.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Fornecedor A' }, userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
