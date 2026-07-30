import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalRecordsService } from './clinical-records.service';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

describe('ClinicalRecordsService', () => {
  let service: ClinicalRecordsService;

  const mockClinicalRepo = {
    findByPatientId: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockPatientRepo = { findOne: jest.fn() };
  const mockAppointmentRepo = { findOne: jest.fn(), update: jest.fn() };
  const mockAccess = {
    getOwnerId: jest.fn(),
    assertSameOwner: jest.fn(),
    canAccessDoctor: jest.fn(),
    resolveDefaultDoctorId: jest.fn(),
  };

  const ownerId = 'owner-1';
  const userId = 'user-1';
  const patientId = 'p1';
  const doctorId = 'd1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.getOwnerId.mockResolvedValue(ownerId);
    mockAccess.assertSameOwner.mockResolvedValue(undefined);
    mockAccess.canAccessDoctor.mockResolvedValue(true);
    mockAccess.resolveDefaultDoctorId.mockResolvedValue(doctorId);
    mockPatientRepo.findOne.mockResolvedValue({ id: patientId, ownerId });
    mockClinicalRepo.create.mockImplementation((d) =>
      Promise.resolve({ id: 'cr-1', ...d }),
    );

    service = new ClinicalRecordsService(
      mockClinicalRepo as any,
      mockPatientRepo as any,
      mockAppointmentRepo as any,
      mockAccess as any,
    );
  });

  describe('create', () => {
    it('cria a ficha resolvendo o médico padrão quando não informado', async () => {
      const result = await service.create(
        { patientId, anamnesis: '<p>x</p>' },
        userId,
      );
      expect(mockAccess.resolveDefaultDoctorId).toHaveBeenCalledWith(userId);
      expect(result).toMatchObject({ ownerId, doctorId, patientId });
    });

    it('rejeita paciente de outra clínica', async () => {
      mockPatientRepo.findOne.mockResolvedValue({
        id: patientId,
        ownerId: 'other',
      });
      await expect(service.create({ patientId }, userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejeita médico não acessível', async () => {
      mockAccess.canAccessDoctor.mockResolvedValue(false);
      await expect(
        service.create({ patientId, doctorId: 'x' }, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('valida a consulta vinculada (owner + paciente)', async () => {
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId: 'outro-paciente',
      });
      await expect(
        service.create({ patientId, appointmentId: 'a1' }, userId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('bloqueia edição de ficha finalizada', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: new Date(),
      });
      await expect(
        service.update('cr-1', { anamnesis: 'y' }, userId),
      ).rejects.toThrow(BadRequestException);
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
    });

    it('atualiza ficha aberta', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });
      await service.update('cr-1', { conduct: 'repouso' }, userId);
      expect(mockClinicalRepo.update).toHaveBeenCalledWith('cr-1', {
        conduct: 'repouso',
      });
    });
  });

  describe('finalize', () => {
    it('finaliza e marca a consulta vinculada como realizada', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: 'a1',
      });
      mockClinicalRepo.update.mockResolvedValue({
        id: 'cr-1',
        finalizedAt: new Date(),
      });

      await service.finalize('cr-1', userId);

      expect(mockClinicalRepo.update).toHaveBeenCalledWith('cr-1', {
        finalizedAt: expect.any(Date),
      });
      expect(mockAppointmentRepo.update).toHaveBeenCalledWith('a1', {
        status: AppointmentStatus.COMPLETED,
      });
    });

    it('não toca em consulta quando a ficha é avulsa', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: null,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.finalize('cr-1', userId);

      expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
    });

    it('bloqueia finalizar uma ficha já finalizada', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: new Date(),
      });
      await expect(service.finalize('cr-1', userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('delete', () => {
    it('bloqueia exclusão de ficha finalizada', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: new Date(),
      });
      await expect(service.delete('cr-1', userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
