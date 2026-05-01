import { NotFoundException } from '@nestjs/common';
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
  };

  const mockAccessValidator = {
    validateAndFetch: jest.fn(),
  };

  const mockTypeOrmRepository = {
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const fakeSurgeryRequest = {
    id: 'sr-1',
    doctor_id: 'doctor-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockOpmeItemRepository.getRepository.mockReturnValue(mockTypeOrmRepository);
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
    it('deve criar item OPME sem fornecedores', async () => {
      const savedEntity = { id: 'opme-1', name: 'Parafuso', quantity: 2, suppliers: [] };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      const result = await service.create(
        { name: 'Parafuso', quantity: 2, surgery_request_id: 'sr-1' },
        'user-1',
      );

      expect(mockAccessValidator.validateAndFetch).toHaveBeenCalledWith('sr-1', 'user-1');
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Parafuso', quantity: 2, suppliers: [] }),
      );
      expect(result).toEqual(savedEntity);
    });

    it('deve vincular fornecedores existentes pelo ID', async () => {
      const supplierA = { id: 'sup-1', name: 'Fornecedor A' };
      const savedEntity = { id: 'opme-1', name: 'Placa', quantity: 1, suppliers: [supplierA] };

      mockSupplierRepository.findOne.mockResolvedValue(supplierA);
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        { name: 'Placa', quantity: 1, surgery_request_id: 'sr-1', supplier_ids: ['sup-1'] },
        'user-1',
      );

      expect(mockSupplierRepository.findOne).toHaveBeenCalledWith({ id: 'sup-1' });
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [supplierA] }),
      );
    });

    it('deve criar novos fornecedores pelo nome e vinculá-los', async () => {
      const createdSupplier = { id: 'sup-new', name: 'Novo Fornecedor' };
      mockSupplierRepository.create.mockResolvedValue(createdSupplier);
      const savedEntity = { id: 'opme-1', name: 'Placa', quantity: 1, suppliers: [createdSupplier] };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        { name: 'Placa', quantity: 1, surgery_request_id: 'sr-1', supplier_names: ['Novo Fornecedor'] },
        'user-1',
      );

      expect(mockSupplierRepository.create).toHaveBeenCalledWith({
        name: 'Novo Fornecedor',
        doctor_id: 'doctor-1',
        active: true,
      });
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [createdSupplier] }),
      );
    });

    it('deve combinar fornecedores existentes e novos', async () => {
      const existingSupplier = { id: 'sup-1', name: 'Existente' };
      const newSupplier = { id: 'sup-new', name: 'Novo' };

      mockSupplierRepository.findOne.mockResolvedValue(existingSupplier);
      mockSupplierRepository.create.mockResolvedValue(newSupplier);

      const savedEntity = { id: 'opme-1', name: 'Implante', quantity: 1, suppliers: [existingSupplier, newSupplier] };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        {
          name: 'Implante',
          quantity: 1,
          surgery_request_id: 'sr-1',
          supplier_ids: ['sup-1'],
          supplier_names: ['Novo'],
        },
        'user-1',
      );

      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [existingSupplier, newSupplier] }),
      );
    });

    it('deve ignorar nomes de fornecedor vazios', async () => {
      const savedEntity = { id: 'opme-1', name: 'Placa', quantity: 1, suppliers: [] };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        { name: 'Placa', quantity: 1, surgery_request_id: 'sr-1', supplier_names: ['', '  ', ''] },
        'user-1',
      );

      expect(mockSupplierRepository.create).not.toHaveBeenCalled();
    });

    it('deve ignorar IDs de fornecedor que não existem', async () => {
      mockSupplierRepository.findOne.mockResolvedValue(null);
      const savedEntity = { id: 'opme-1', name: 'Placa', quantity: 1, suppliers: [] };
      mockTypeOrmRepository.create.mockReturnValue(savedEntity);
      mockTypeOrmRepository.save.mockResolvedValue(savedEntity);

      await service.create(
        { name: 'Placa', quantity: 1, surgery_request_id: 'sr-1', supplier_ids: ['nonexistent'] },
        'user-1',
      );

      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [] }),
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    const existingOpme = {
      id: 'opme-1',
      name: 'Parafuso',
      brand: null,
      quantity: 2,
      surgery_request_id: 'sr-1',
      suppliers: [],
    };

    beforeEach(() => {
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue({ ...existingOpme });
    });

    it('deve lançar NotFoundException se item não encontrado', async () => {
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue(null);

      await expect(
        service.update({ id: 'nonexistent' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve atualizar campos básicos', async () => {
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

    it('deve sincronizar fornecedores quando supplier_ids fornecido', async () => {
      const supplierA = { id: 'sup-1', name: 'Fornecedor A' };
      mockSupplierRepository.findOne.mockResolvedValue(supplierA);
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      await service.update(
        { id: 'opme-1', supplier_ids: ['sup-1'] },
        'user-1',
      );

      expect(mockOpmeItemRepository.saveWithSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [supplierA] }),
      );
    });

    it('deve criar novos fornecedores ao atualizar com supplier_names', async () => {
      const newSupplier = { id: 'sup-new', name: 'Novo' };
      mockSupplierRepository.create.mockResolvedValue(newSupplier);
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      await service.update(
        { id: 'opme-1', supplier_names: ['Novo'] },
        'user-1',
      );

      expect(mockSupplierRepository.create).toHaveBeenCalledWith({
        name: 'Novo',
        doctor_id: 'doctor-1',
        active: true,
      });
    });

    it('não deve alterar fornecedores se nem supplier_ids nem supplier_names fornecidos', async () => {
      const opmeWithSuppliers = {
        ...existingOpme,
        suppliers: [{ id: 'sup-1', name: 'Existente' }],
      };
      mockOpmeItemRepository.findByIdWithSuppliers.mockResolvedValue(opmeWithSuppliers);
      mockOpmeItemRepository.saveWithSuppliers.mockResolvedValue(undefined);

      await service.update({ id: 'opme-1', name: 'Novo nome' }, 'user-1');

      expect(mockOpmeItemRepository.saveWithSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ suppliers: [{ id: 'sup-1', name: 'Existente' }] }),
      );
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deve deletar item OPME com sucesso', async () => {
      const opmeItem = { id: 'opme-1', surgery_request_id: 'sr-1', suppliers: [] };
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
