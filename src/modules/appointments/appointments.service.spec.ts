import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  const mockAppointmentRepository = {
    findAgenda: jest.fn(),
    findByPatient: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    hasOverlap: jest.fn(),
  };

  const mockPatientRepository = {
    findOne: jest.fn(),
  };

  const mockAccessControlService = {
    getOwnerId: jest.fn(),
    getAccessibleDoctorIds: jest.fn(),
    canAccessDoctor: jest.fn(),
    assertSameOwner: jest.fn(),
  };

  const ownerId = 'owner-1';
  const userId = 'user-1';
  const doctorId = 'doctor-1';
  const patientId = 'patient-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessControlService.getOwnerId.mockResolvedValue(ownerId);
    mockAccessControlService.canAccessDoctor.mockResolvedValue(true);
    mockAccessControlService.assertSameOwner.mockResolvedValue(undefined);
    mockPatientRepository.findOne.mockResolvedValue({ id: patientId, ownerId });
    mockAppointmentRepository.hasOverlap.mockResolvedValue(false);
    mockAppointmentRepository.create.mockImplementation((d) =>
      Promise.resolve({ id: 'appt-1', ...d }),
    );

    service = new AppointmentsService(
      mockAppointmentRepository as any,
      mockPatientRepository as any,
      mockAccessControlService as any,
    );
  });

  const baseCreate = {
    patientId,
    doctorId,
    scheduledAt: '2026-08-01T14:00:00.000Z',
    durationMinutes: 30,
  };

  describe('findByPatient', () => {
    it('retorna vazio quando não há médicos acessíveis (fail-closed)', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([]);

      const result = await service.findByPatient(patientId, userId);

      expect(result).toEqual({ total: 0, records: [] });
      expect(mockAppointmentRepository.findByPatient).not.toHaveBeenCalled();
    });

    it('escopa a busca aos médicos acessíveis', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      mockAppointmentRepository.findByPatient.mockResolvedValue([{ id: 'a-1' }]);

      const result = await service.findByPatient(patientId, userId);

      expect(mockAppointmentRepository.findByPatient).toHaveBeenCalledWith(
        [doctorId],
        patientId,
      );
      expect(result).toEqual({ total: 1, records: [{ id: 'a-1' }] });
    });
  });

  describe('create', () => {
    it('cria a consulta quando não há conflito', async () => {
      const result = await service.create(baseCreate, userId);

      expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalledWith(
        doctorId,
        new Date('2026-08-01T14:00:00.000Z'),
        new Date('2026-08-01T14:30:00.000Z'),
        undefined,
      );
      expect(result).toMatchObject({
        ownerId,
        doctorId,
        patientId,
        status: AppointmentStatus.SCHEDULED,
      });
    });

    it('lança ConflictException quando há sobreposição de horário', async () => {
      mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

      await expect(service.create(baseCreate, userId)).rejects.toThrow(
        ConflictException,
      );
      expect(mockAppointmentRepository.create).not.toHaveBeenCalled();
    });

    it('lança ForbiddenException quando o médico não é acessível', async () => {
      mockAccessControlService.canAccessDoctor.mockResolvedValue(false);

      await expect(service.create(baseCreate, userId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lança NotFoundException quando o paciente é de outra clínica', async () => {
      mockPatientRepository.findOne.mockResolvedValue({
        id: patientId,
        ownerId: 'other-owner',
      });

      await expect(service.create(baseCreate, userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('revalida conflito ao reagendar, ignorando a própria consulta', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.update(
        'appt-1',
        { scheduledAt: '2026-08-01T15:00:00.000Z' },
        userId,
      );

      expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalledWith(
        doctorId,
        new Date('2026-08-01T15:00:00.000Z'),
        new Date('2026-08-01T15:30:00.000Z'),
        'appt-1',
      );
    });

    it('não revalida conflito quando apenas as notas mudam', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.update('appt-1', { notes: 'retorno' }, userId);

      expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('grava o motivo ao cancelar', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue({
        id: 'appt-1',
        ownerId,
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CANCELLED, cancellationReason: 'paciente' },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: 'paciente',
      });
    });

    it('limpa o motivo ao mudar para um status não-cancelado', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue({
        id: 'appt-1',
        ownerId,
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CONFIRMED },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
        status: AppointmentStatus.CONFIRMED,
        cancellationReason: null,
      });
    });
  });

  describe('findAgenda', () => {
    it('retorna vazio quando não há médicos acessíveis', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([]);

      const result = await service.findAgenda(
        { from: '2026-08-01', to: '2026-08-31' },
        userId,
      );

      expect(result).toEqual({ total: 0, records: [] });
      expect(mockAppointmentRepository.findAgenda).not.toHaveBeenCalled();
    });

    it('restringe ao médico do filtro somente se acessível', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
        'doctor-2',
      ]);
      mockAppointmentRepository.findAgenda.mockResolvedValue([]);

      await service.findAgenda(
        { from: '2026-08-01', to: '2026-08-31', doctorId },
        userId,
      );

      expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
        [doctorId],
        expect.any(Date),
        expect.any(Date),
        expect.any(Number),
      );
    });

    it('ignora filtro de médico não acessível (fail-closed)', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      mockAppointmentRepository.findAgenda.mockResolvedValue([]);

      await service.findAgenda(
        { from: '2026-08-01', to: '2026-08-31', doctorId: 'intruder' },
        userId,
      );

      expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
        [doctorId],
        expect.any(Date),
        expect.any(Date),
        expect.any(Number),
      );
    });
  });
});
