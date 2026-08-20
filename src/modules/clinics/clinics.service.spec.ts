import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import { emptyBusinessHours } from 'src/shared/business-hours/business-hours.util';

describe('ClinicsService', () => {
  let service: ClinicsService;

  const mockClinicRepository = {
    total: jest.fn(),
    findMany: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getRepository: jest.fn(),
  };

  const mockAccessControlService = {
    getOwnerId: jest.fn(),
    assertSameOwner: jest.fn(),
  };

  const ownerId = 'owner-1';
  const userId = 'user-1';
  const softDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessControlService.getOwnerId.mockResolvedValue(ownerId);
    mockAccessControlService.assertSameOwner.mockResolvedValue(undefined);
    mockClinicRepository.findOne.mockResolvedValue(null);
    mockClinicRepository.total.mockResolvedValue(0);
    mockClinicRepository.findMany.mockResolvedValue([]);
    mockClinicRepository.create.mockImplementation((d: unknown) =>
      Promise.resolve({ id: 'clinic-1', ...(d as object) }),
    );
    mockClinicRepository.update.mockImplementation((id: string, d: unknown) =>
      Promise.resolve({ id, ...(d as object) }),
    );
    mockClinicRepository.getRepository.mockReturnValue({ softDelete });

    service = new ClinicsService(
      mockClinicRepository as any,
      mockAccessControlService as any,
    );
  });

  describe('create', () => {
    it('grava a clínica com o ownerId do usuário e a grade normalizada', async () => {
      await service.create({ name: 'Unidade Centro' }, userId);

      expect(mockClinicRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Unidade Centro',
          ownerId,
          active: true,
          businessHours: emptyBusinessHours(),
        }),
      );
    });

    it('normaliza a grade preenchendo os dias ausentes', async () => {
      await service.create(
        {
          name: 'Unidade Centro',
          businessHours: { mon: [{ start: '08:00', end: '12:00' }] } as any,
        },
        userId,
      );

      const gravado = mockClinicRepository.create.mock.calls[0][0];
      expect(gravado.businessHours.mon).toEqual([
        { start: '08:00', end: '12:00' },
      ]);
      expect(gravado.businessHours.sun).toEqual([]);
    });

    it('recusa nome já usado na mesma conta', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'outra',
        name: 'Unidade Centro',
        ownerId,
      });

      await expect(
        service.create({ name: 'Unidade Centro' }, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findOne', () => {
    it('recusa clínica de outra conta', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-1',
        ownerId: 'outro-owner',
      });
      mockAccessControlService.assertSameOwner.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(service.findOne('clinic-1', userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('normaliza a grade na leitura (linha antiga com jsonb vazio)', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-1',
        ownerId,
        businessHours: {},
      });

      const clinic = await service.findOne('clinic-1', userId);
      expect(clinic.businessHours).toEqual(emptyBusinessHours());
    });

    it('devolve 404 quando não existe', async () => {
      mockClinicRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne('sumida', userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('substitui a grade inteira, normalizada', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-1',
        ownerId,
        businessHours: emptyBusinessHours(),
      });

      await service.update(
        'clinic-1',
        { businessHours: { fri: [{ start: '09:00', end: '17:00' }] } as any },
        userId,
      );

      const [, dados] = mockClinicRepository.update.mock.calls[0];
      expect(dados.businessHours.fri).toEqual([
        { start: '09:00', end: '17:00' },
      ]);
      expect(dados.businessHours.mon).toEqual([]);
    });

    it('não toca na grade quando o payload não a inclui', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-1',
        ownerId,
        businessHours: emptyBusinessHours(),
      });

      await service.update('clinic-1', { name: 'Novo nome' }, userId);

      const [, dados] = mockClinicRepository.update.mock.calls[0];
      expect(dados).not.toHaveProperty('businessHours');
    });
  });

  describe('delete', () => {
    it('exclui por soft delete, preservando o vínculo das consultas antigas', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-1',
        ownerId,
      });

      await service.delete('clinic-1', userId);

      expect(mockClinicRepository.delete).toHaveBeenCalledWith('clinic-1');
    });
  });

  describe('bulkDelete', () => {
    it('recusa o lote inteiro quando algum id não é da conta', async () => {
      mockClinicRepository.findMany.mockResolvedValue([{ id: 'a', ownerId }]);

      await expect(
        service.bulkDelete(['a', 'b'], userId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(softDelete).not.toHaveBeenCalled();
    });

    it('soft-deleta os ids únicos', async () => {
      mockClinicRepository.findMany.mockResolvedValue([
        { id: 'a', ownerId },
        { id: 'b', ownerId },
      ]);

      const resultado = await service.bulkDelete(['a', 'b', 'a'], userId);

      expect(softDelete).toHaveBeenCalledWith(['a', 'b']);
      expect(resultado).toEqual({ deleted: 2 });
    });
  });
});
