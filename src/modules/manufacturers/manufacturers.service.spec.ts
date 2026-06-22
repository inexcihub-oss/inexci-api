import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ManufacturersService } from './manufacturers.service';

describe('ManufacturersService', () => {
  let service: ManufacturersService;

  const mockManufacturerRepository = {
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

  const ownerId = 'owner-1';
  const userId = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessControlService.getOwnerId.mockResolvedValue(ownerId);
    mockAccessControlService.assertSameOwner.mockResolvedValue(undefined);

    service = new ManufacturersService(
      mockManufacturerRepository as any,
      mockAccessControlService as any,
    );
  });

  describe('delete', () => {
    it('deve aplicar soft delete em vez de remover o registro', async () => {
      mockManufacturerRepository.findOne.mockResolvedValue({
        id: 'man-1',
        ownerId,
      });

      await service.delete('man-1', userId);

      expect(mockManufacturerRepository.softDelete).toHaveBeenCalledWith(
        'man-1',
      );
    });

    it('deve lançar NotFoundException se fabricante não existir', async () => {
      mockManufacturerRepository.findOne.mockResolvedValue(null);

      await expect(service.delete('man-1', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkDelete', () => {
    it('deve aplicar soft delete em lote', async () => {
      mockManufacturerRepository.findMany.mockResolvedValue([
        { id: 'man-1', ownerId },
      ]);

      const result = await service.bulkDelete(['man-1'], userId);

      expect(mockManufacturerRepository.bulkSoftDelete).toHaveBeenCalledWith([
        'man-1',
      ]);
      expect(result).toEqual({ deleted: 1 });
    });
  });

  describe('create', () => {
    it('deve restaurar fabricante soft-deleted com o mesmo nome', async () => {
      mockManufacturerRepository.findByNameIncludingDeleted.mockResolvedValue({
        id: 'man-1',
        name: 'Fabricante A',
        deletedAt: new Date(),
      });
      mockManufacturerRepository.update.mockResolvedValue({
        id: 'man-1',
        name: 'Fabricante A',
      });

      const result = await service.create({ name: 'Fabricante A' }, userId);

      expect(mockManufacturerRepository.restore).toHaveBeenCalledWith('man-1');
      expect(mockManufacturerRepository.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'man-1', name: 'Fabricante A' });
    });

    it('deve lançar ConflictException se já existir fabricante ativo', async () => {
      mockManufacturerRepository.findByNameIncludingDeleted.mockResolvedValue({
        id: 'man-1',
        name: 'Fabricante A',
        deletedAt: null,
      });

      await expect(
        service.create({ name: 'Fabricante A' }, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('deve lançar ForbiddenException se usuário não tiver clínica', async () => {
      mockAccessControlService.getOwnerId.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Fabricante A' }, userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
