import {
  BadRequestException,
  ConflictException,
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
  const mockSurgicalIndication = { createForRecord: jest.fn() };

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

    mockSurgicalIndication.createForRecord.mockResolvedValue({ id: 'sc-1' });

    service = new ClinicalRecordsService(
      mockClinicalRepo as any,
      mockPatientRepo as any,
      mockAppointmentRepo as any,
      mockAccess as any,
      mockSurgicalIndication as any,
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

    it('cria a ficha da consulta quando ainda não existe nenhuma', async () => {
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId,
      });
      mockClinicalRepo.findOne.mockResolvedValue(null);

      const result = await service.create(
        { patientId, appointmentId: 'a1' },
        userId,
      );

      expect(mockClinicalRepo.findOne).toHaveBeenCalledWith({
        appointmentId: 'a1',
      });
      expect(result).toMatchObject({ appointmentId: 'a1', patientId });
    });

    it('rejeita segunda ficha para a mesma consulta', async () => {
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId,
      });
      mockClinicalRepo.findOne.mockResolvedValue({ id: 'cr-existente' });

      await expect(
        service.create({ patientId, appointmentId: 'a1' }, userId),
      ).rejects.toThrow(ConflictException);
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
    });

    it('não checa duplicidade em atendimento avulso (sem consulta)', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-de-outra-consulta',
      });

      const result = await service.create({ patientId }, userId);

      expect(mockClinicalRepo.findOne).not.toHaveBeenCalled();
      expect(result).toMatchObject({ appointmentId: null });
    });

    it('persiste o marcador de paciente cirúrgico', async () => {
      const result = await service.create(
        { patientId, surgicalIndication: true },
        userId,
      );
      expect(result).toMatchObject({ surgicalIndication: true });
    });

    it('grava o marcador como falso quando não informado', async () => {
      const result = await service.create({ patientId }, userId);
      expect(result).toMatchObject({ surgicalIndication: false });
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

    it('atualiza o marcador de paciente cirúrgico', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.update('cr-1', { surgicalIndication: true }, userId);

      expect(mockClinicalRepo.update).toHaveBeenCalledWith('cr-1', {
        surgicalIndication: true,
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

    it('cria a SC quando a ficha tem indicação cirúrgica', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: null,
        surgicalIndication: true,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      const result = await service.finalize('cr-1', userId);

      expect(mockSurgicalIndication.createForRecord).toHaveBeenCalledWith(
        'cr-1',
        userId,
      );
      // A ficha é devolvida antes de a SC existir; o id é costurado na resposta
      // para o frontend já poder linkar a solicitação.
      expect(result).toMatchObject({ surgeryRequestId: 'sc-1' });
    });

    it('não cria SC quando a ficha não tem indicação', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: null,
        surgicalIndication: false,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.finalize('cr-1', userId);

      expect(mockSurgicalIndication.createForRecord).not.toHaveBeenCalled();
    });

    // O ponto central do desenho: perder a SC é aceitável no curto prazo (o
    // sweeper retoma), perder o atendimento do médico nunca é.
    it('finaliza o atendimento mesmo se a criação da SC falhar', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: 'a1',
        surgicalIndication: true,
      });
      mockClinicalRepo.update.mockResolvedValue({
        id: 'cr-1',
        finalizedAt: new Date(),
      });
      mockSurgicalIndication.createForRecord.mockRejectedValue(
        new Error('banco fora'),
      );

      const result = await service.finalize('cr-1', userId);

      expect(result).toMatchObject({ id: 'cr-1' });
      expect(result.surgeryRequestId).toBeUndefined();
      expect(mockAppointmentRepo.update).toHaveBeenCalledWith('a1', {
        status: AppointmentStatus.COMPLETED,
      });
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
