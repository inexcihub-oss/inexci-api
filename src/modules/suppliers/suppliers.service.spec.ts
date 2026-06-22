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
