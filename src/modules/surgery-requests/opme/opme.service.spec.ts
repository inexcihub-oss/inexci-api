import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OpmeService } from './opme.service';

describe('OpmeService', () => {
  let service: OpmeService;

  const mockOpmeItemRepository = {
    findOne: jest.fn(),
    findByIdWithSuppliers: jest.fn(),
    getRepository: jest.fn(),
    saveWithSuppliers: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockSupplierRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    getRepository: jest.fn(),
  };

  const mockAccessValidator = {
    validateAndFetch: jest.fn(),
  };

  const mockTypeOrmRepository = {
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const mockSupplierTypeOrmRepository = {
    findOne: jest.fn(),
  };

  const fakeSurgeryRequest = {
    id: 'sr-1',
    doctorId: 'doctor-1',
    ownerId: 'owner-1',
  };

  const validBrand = 'Fabricante A, Fabricante B, Fabricante C';

  const makeSuppliers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `sup-${i + 1}`,
      name: `Fornecedor ${i + 1}`,
    }));

  beforeEach(() => {
    jest.clearAllMocks();

    mockOpmeItemRepository.getRepository.mockReturnValue(mockTypeOrmRepository);
    mockSupplierRepository.getRepository.mockReturnValue(
      mockSupplierTypeOrmRepository,
    );
    mockSupplierTypeOrmRepository.findOne.mockResolvedValue(null);
    mockAccessValidator.validateAndFetch.mockResolvedValue(fakeSurgeryRequest);

    service = new OpmeService(
      mockOpmeItemRepository as any,
      mockSupplierRepository as any,
      mockAccessValidator as any,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('deve lançar BadRequestException se brand não fornecido (fabricantes < 3)', async () => {
      await expect(
        service.create(
          {
            name: 'Parafuso',
            quantity: 2,
            surgeryRequestId: 'sr-1',
            supplierIds: ['s1', 's2', 's3'],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se brand tem menos de 3 fabricantes', async () => {
      await expect(
        service.create(
          {
            name: 'Parafuso',
            brand: 'Fab A, Fab B',
            quantity: 2,
            surgeryRequestId: 'sr-1',
            supplierIds: ['s1', 's2', 's3'],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se fornecedores totais < 3', async () => {
      await expect(
        service.create(
          {
            name: 'Parafuso',
            brand: validBrand,
            quantity: 2,
            surgeryRequestId: 'sr-1',
            supplierNames: ['Fornecedor A', 'Fornecedor B'],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se nenhum fornecedor informado', async () => {
      await expect(
        service.create(
          {
            name: 'Parafuso',
            brand: validBrand,
            quantity: 2,
            surgeryRequestId: 'sr-1',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve criar item OPME com 3 fabricantes e 3 fornecedores por nome', async () => {
      const suppliers = makeSuppliers(3);
      suppliers.forEach((s) =>
        mockSupplierRepository.create.mockResolvedValueOnce(s),
      );

      const savedEntity = {
        id: 'opme-1',
        name: 'Parafuso',
        quantity: 2,
        suppliers,
      };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      const result = await service.create(
        {
          name: 'Parafuso',
          brand: validBrand,
          quantity: 2,
          surgeryRequestId: 'sr-1',
          supplierNames: ['Fornecedor 1', 'Fornecedor 2', 'Fornecedor 3'],
        },
        'user-1',
      );

      expect(mockAccessValidator.validateAndFetch).toHaveBeenCalledWith(
        'sr-1',
        'user-1',
      );
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
      expect(result).toEqual(savedEntity);
    });

    it('deve criar item OPME com 3 fornecedores existentes por ID', async () => {
      const suppliers = makeSuppliers(3);
      suppliers.forEach((s) =>
        mockSupplierRepository.findOne.mockResolvedValueOnce(s),
      );

      const savedEntity = {
        id: 'opme-1',
        name: 'Placa',
        quantity: 1,
        suppliers,
      };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        {
          name: 'Placa',
          brand: validBrand,
          quantity: 1,
          surgeryRequestId: 'sr-1',
          supplierIds: ['sup-1', 'sup-2', 'sup-3'],
        },
        'user-1',
      );

      expect(mockSupplierRepository.findOne).toHaveBeenCalledTimes(3);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers }),
      );
    });

    it('deve aceitar combinação de IDs + nomes desde que totalizem >= 3', async () => {
      const existingSupplier = { id: 'sup-1', name: 'Existente' };
      const newSupplierA = { id: 'sup-new-1', name: 'Novo A' };
      const newSupplierB = { id: 'sup-new-2', name: 'Novo B' };

      mockSupplierRepository.findOne.mockResolvedValue(existingSupplier);
      mockSupplierRepository.create
        .mockResolvedValueOnce(newSupplierA)
        .mockResolvedValueOnce(newSupplierB);

      const savedEntity = {
        id: 'opme-1',
        name: 'Implante',
        quantity: 1,
        suppliers: [existingSupplier, newSupplierA, newSupplierB],
      };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        {
          name: 'Implante',
          brand: validBrand,
          quantity: 1,
          surgeryRequestId: 'sr-1',
          supplierIds: ['sup-1'],
          supplierNames: ['Novo A', 'Novo B'],
        },
        'user-1',
      );

      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          suppliers: [existingSupplier, newSupplierA, newSupplierB],
        }),
      );
    });

    it('deve ignorar nomes de fornecedor em branco na contagem de fornecedores preenchidos', async () => {
      await expect(
        service.create(
          {
            name: 'Placa',
            brand: validBrand,
            quantity: 1,
            surgeryRequestId: 'sr-1',
            supplierNames: ['Fornecedor A', '', '  '],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    const existingOpme = {
      id: 'opme-1',
      name: 'Parafuso',
      brand: validBrand,
      quantity: 2,
      surgeryRequestId: 'sr-1',
      suppliers: makeSuppliers(3),
    };

    beforeEach(() => {
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue({
        ...existingOpme,
        suppliers: [...existingOpme.suppliers],
      });
    });

    it('deve lançar NotFoundException se item não encontrado', async () => {
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue(null);

      await expect(
        service.update({ id: 'nonexistent' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve atualizar campos básicos sem tocar em fornecedores', async () => {
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      const result = await service.update(
        { id: 'opme-1', name: 'Parafuso Novo', quantity: 5 },
        'user-1',
      );

      expect(mockOpmeItemRepository.saveWithSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Parafuso Novo', quantity: 5 }),
      );
      expect(result).toEqual({ message: 'OPME atualizado com sucesso' });
    });

    it('deve lançar BadRequestException ao atualizar brand com menos de 3 fabricantes', async () => {
      await expect(
        service.update({ id: 'opme-1', brand: 'Fab A, Fab B' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException ao atualizar fornecedores com menos de 3', async () => {
      await expect(
        service.update(
          { id: 'opme-1', supplierNames: ['Fornecedor A', 'Fornecedor B'] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve sincronizar 3 fornecedores existentes por ID', async () => {
      const suppliers = makeSuppliers(3);
      suppliers.forEach((s) =>
        mockSupplierRepository.findOne.mockResolvedValueOnce(s),
      );
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      await service.update(
        { id: 'opme-1', supplierIds: ['sup-1', 'sup-2', 'sup-3'] },
        'user-1',
      );

      expect(mockOpmeItemRepository.saveWithSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers }),
      );
    });

    it('deve criar 3 novos fornecedores ao atualizar com supplierNames', async () => {
      const suppliers = makeSuppliers(3);
      suppliers.forEach((s) =>
        mockSupplierRepository.create.mockResolvedValueOnce(s),
      );
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      await service.update(
        {
          id: 'opme-1',
          supplierNames: ['Fornecedor 1', 'Fornecedor 2', 'Fornecedor 3'],
        },
        'user-1',
      );

      expect(mockSupplierRepository.create).toHaveBeenCalledTimes(3);
    });

    it('não deve alterar fornecedores se nem supplierIds nem supplierNames fornecidos', async () => {
      const existingSuppliers = makeSuppliers(3);
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue({
        ...existingOpme,
        suppliers: existingSuppliers,
      });
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      await service.update({ id: 'opme-1', name: 'Novo nome' }, 'user-1');

      expect(mockOpmeItemRepository.saveWithSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: existingSuppliers }),
      );
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deve deletar item OPME com sucesso', async () => {
      const opmeItem = {
        id: 'opme-1',
        surgeryRequestId: 'sr-1',
        suppliers: makeSuppliers(3),
      };
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue(opmeItem);
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);
      mockTypeOrmRepository.remove.mockResolvedValue(undefined);

      const result = await service.delete('opme-1', 'user-1');

      expect(mockOpmeItemRepository.saveWithSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [] }),
      );
      expect(mockTypeOrmRepository.remove).toHaveBeenCalledWith(opmeItem);
      expect(result).toEqual({ message: 'OPME removido com sucesso' });
    });

    it('deve lançar NotFoundException se item não encontrado', async () => {
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue(null);

      await expect(service.delete('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
