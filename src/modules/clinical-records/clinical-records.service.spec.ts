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
    assertCanAccessDoctorResource: jest.fn(),
    getAccessibleDoctorIds: jest.fn(),
    canAccessDoctor: jest.fn(),
    resolveDefaultDoctorId: jest.fn(),
    assertIsDoctor: jest.fn(),
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
    mockAccess.assertCanAccessDoctorResource.mockResolvedValue(undefined);
    mockAccess.getAccessibleDoctorIds.mockResolvedValue([doctorId]);
    mockAccess.canAccessDoctor.mockResolvedValue(true);
    mockAccess.resolveDefaultDoctorId.mockResolvedValue(doctorId);
    mockAccess.assertIsDoctor.mockResolvedValue(undefined);
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
        doctorId,
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
        doctorId,
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

  /**
   * Atender é ato do médico. Quem não tem `doctor_profile` — secretária,
   * assistente, admin não-médico — enxerga o prontuário dos médicos a que tem
   * vínculo, mas não escreve nele: a ficha vira documento assinado em nome do
   * médico da consulta.
   */
  describe('somente médico atende', () => {
    const aberta = {
      id: 'cr-1',
      ownerId,
      doctorId,
      finalizedAt: null,
      appointmentId: null,
      surgicalIndication: false,
    };

    beforeEach(() => {
      mockClinicalRepo.findOne.mockResolvedValue(aberta);
      mockAccess.assertIsDoctor.mockRejectedValue(new ForbiddenException());
    });

    it.each([
      ['iniciar atendimento', () => service.create({ patientId }, userId)],
      ['editar', () => service.update('cr-1', { conduct: 'x' }, userId)],
      ['finalizar', () => service.finalize('cr-1', userId)],
      ['excluir', () => service.delete('cr-1', userId)],
    ])('bloqueia não-médico de %s', async (_label, action) => {
      await expect(action()).rejects.toThrow(ForbiddenException);

      expect(mockAccess.assertIsDoctor).toHaveBeenCalledWith(userId);
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
      expect(mockClinicalRepo.delete).not.toHaveBeenCalled();
    });

    it.each([
      ['ler a ficha', () => service.findOne('cr-1', userId)],
      ['retomar pela consulta', () => service.findByAppointment('a1', userId)],
      ['ver a timeline', () => service.findByPatient(patientId, userId)],
    ])('mantém a leitura liberada: %s', async (_label, action) => {
      mockClinicalRepo.findByPatientId.mockResolvedValue([]);

      await expect(action()).resolves.toBeDefined();
    });
  });

  /**
   * O prontuário é dado clínico sensível: pertencer à mesma clínica não basta,
   * é preciso ter vínculo com o médico da ficha (`user_doctor_access`).
   */
  describe('fronteira de acesso por médico', () => {
    const alheia = {
      id: 'cr-alheia',
      ownerId,
      doctorId: 'd2',
      finalizedAt: null,
      appointmentId: null,
      surgicalIndication: false,
    };

    beforeEach(() => {
      mockClinicalRepo.findOne.mockResolvedValue(alheia);
      mockAccess.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      ['ler', () => service.findOne('cr-alheia', userId)],
      [
        'retomar pela consulta',
        () => service.findByAppointment('a-alheia', userId),
      ],
      ['editar', () => service.update('cr-alheia', { conduct: 'x' }, userId)],
      ['finalizar', () => service.finalize('cr-alheia', userId)],
      ['excluir', () => service.delete('cr-alheia', userId)],
    ])(
      'bloqueia %s a ficha de um médico fora do acesso do usuário',
      async (_label, action) => {
        await expect(action()).rejects.toThrow(ForbiddenException);

        expect(mockAccess.assertCanAccessDoctorResource).toHaveBeenCalledWith(
          userId,
          ownerId,
          'd2',
        );
        expect(mockClinicalRepo.update).not.toHaveBeenCalled();
        expect(mockClinicalRepo.delete).not.toHaveBeenCalled();
        expect(mockSurgicalIndication.createForRecord).not.toHaveBeenCalled();
      },
    );

    it('recorta a timeline do paciente pelos médicos acessíveis', async () => {
      mockAccess.getAccessibleDoctorIds.mockResolvedValue([doctorId]);
      mockClinicalRepo.findByPatientId.mockResolvedValue([]);

      await service.findByPatient(patientId, userId);

      expect(mockClinicalRepo.findByPatientId).toHaveBeenCalledWith(
        ownerId,
        [doctorId],
        patientId,
      );
    });

    it('devolve timeline vazia quando não há médico acessível (fail-closed)', async () => {
      mockAccess.getAccessibleDoctorIds.mockResolvedValue([]);

      await expect(service.findByPatient(patientId, userId)).resolves.toEqual(
        [],
      );

      expect(mockClinicalRepo.findByPatientId).not.toHaveBeenCalled();
    });

    it('recusa vincular a ficha à consulta de outro médico', async () => {
      mockAccess.assertCanAccessDoctorResource.mockResolvedValue(undefined);
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId,
        doctorId: 'd2',
      });

      await expect(
        service.create({ patientId, appointmentId: 'a1' }, userId),
      ).rejects.toThrow(BadRequestException);
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
    });
  });
});
