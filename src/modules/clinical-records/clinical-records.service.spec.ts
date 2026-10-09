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
    assertIsPhysicianWithRegistry: jest.fn(),
    assertIsPhysician: jest.fn(),
  };
  const mockSurgicalIndication = { createForRecord: jest.fn() };
  const mockActivityRepo = {
    create: jest.fn().mockResolvedValue({}),
    findByAppointment: jest.fn().mockResolvedValue([]),
  };
  const mockProcedureRepo = { findOne: jest.fn() };

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
    mockAccess.assertIsPhysicianWithRegistry.mockResolvedValue(undefined);
    mockAccess.assertIsPhysician.mockResolvedValue(undefined);
    mockPatientRepo.findOne.mockResolvedValue({ id: patientId, ownerId });
    mockClinicalRepo.create.mockImplementation((d) =>
      Promise.resolve({ id: 'cr-1', ...d }),
    );
    mockAppointmentRepo.findOne.mockResolvedValue({
      id: 'a1',
      ownerId,
      patientId,
      doctorId,
      status: AppointmentStatus.SCHEDULED,
    });

    mockSurgicalIndication.createForRecord.mockResolvedValue({ id: 'sc-1' });
    mockProcedureRepo.findOne.mockResolvedValue({ id: 'proc-1', ownerId });

    service = new ClinicalRecordsService(
      mockClinicalRepo as any,
      mockPatientRepo as any,
      mockAppointmentRepo as any,
      mockAccess as any,
      mockSurgicalIndication as any,
      mockActivityRepo as any,
      mockProcedureRepo as any,
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

    it('recusa indicação cirúrgica em ficha de profissional que não é médico', async () => {
      mockAccess.assertIsPhysicianWithRegistry.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create({ patientId, surgicalIndication: true }, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAccess.assertIsPhysicianWithRegistry).toHaveBeenCalledWith(
        doctorId,
        expect.any(String),
        'indicar cirurgia',
      );
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
    });

    it('recusa indicação cirúrgica de médico com CRM sem número', async () => {
      mockAccess.assertIsPhysicianWithRegistry.mockRejectedValue(
        new BadRequestException(
          'Preencha o número do CRM de Karina em Colaboradores antes de indicar cirurgia.',
        ),
      );

      await expect(
        service.create({ patientId, surgicalIndication: true }, userId),
      ).rejects.toThrow('Preencha o número do CRM de Karina');
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
    });

    it('recusa indicação cirúrgica marcada por quem não é médico, mesmo em ficha de médico', async () => {
      mockAccess.assertIsPhysician.mockRejectedValue(new ForbiddenException());

      await expect(
        service.create({ patientId, surgicalIndication: true }, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAccess.assertIsPhysician).toHaveBeenCalledWith(
        userId,
        expect.any(String),
      );
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
    });

    it('o próprio médico da ficha não é conferido duas vezes', async () => {
      mockAccess.resolveDefaultDoctorId.mockResolvedValue(userId);

      await service.create({ patientId, surgicalIndication: true }, userId);

      expect(mockAccess.assertIsPhysicianWithRegistry).toHaveBeenCalledWith(
        userId,
        expect.any(String),
        'indicar cirurgia',
      );
      expect(mockAccess.assertIsPhysician).not.toHaveBeenCalled();
    });

    it('profissional que não é médico registra ficha sem indicação', async () => {
      mockAccess.assertIsPhysicianWithRegistry.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create({ patientId }, userId),
      ).resolves.toMatchObject({ surgicalIndication: false });
      expect(mockAccess.assertIsPhysicianWithRegistry).not.toHaveBeenCalled();
    });

    it('persiste o procedimento escolhido quando pertence à clínica', async () => {
      const result = await service.create(
        { patientId, procedureId: 'proc-1' },
        userId,
      );
      expect(mockProcedureRepo.findOne).toHaveBeenCalledWith({
        id: 'proc-1',
      });
      expect(result).toMatchObject({ procedureId: 'proc-1' });
    });

    it('rejeita procedimento de outra clínica', async () => {
      mockProcedureRepo.findOne.mockResolvedValue({
        id: 'proc-1',
        ownerId: 'outra-clinica',
      });
      await expect(
        service.create({ patientId, procedureId: 'proc-1' }, userId),
      ).rejects.toThrow(NotFoundException);
      expect(mockClinicalRepo.create).not.toHaveBeenCalled();
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

    it('recusa marcar indicação em ficha de profissional que não é médico', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        doctorId: 'nutricionista-1',
        finalizedAt: null,
      });
      mockAccess.assertIsPhysicianWithRegistry.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.update('cr-1', { surgicalIndication: true }, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAccess.assertIsPhysicianWithRegistry).toHaveBeenCalledWith(
        'nutricionista-1',
        expect.any(String),
        'indicar cirurgia',
      );
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
    });

    it('recusa marcar indicação quando quem age não é médico (dentista vinculado)', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        doctorId,
        finalizedAt: null,
      });
      mockAccess.assertIsPhysician.mockRejectedValue(new ForbiddenException());

      await expect(
        service.update('cr-1', { surgicalIndication: true }, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAccess.assertIsPhysician).toHaveBeenCalledWith(
        userId,
        expect.any(String),
      );
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
    });

    it('reenviar a indicação já marcada não reconfere o CRM (salvar a anamnese)', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        doctorId: 'dentista-1',
        surgicalIndication: true,
        finalizedAt: null,
      });
      mockAccess.assertIsPhysicianWithRegistry.mockRejectedValue(
        new ForbiddenException(),
      );
      mockAccess.assertIsPhysician.mockRejectedValue(new ForbiddenException());
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.update(
        'cr-1',
        { anamnesis: '<p>dor</p>', surgicalIndication: true },
        userId,
      );

      expect(mockAccess.assertIsPhysicianWithRegistry).not.toHaveBeenCalled();
      expect(mockAccess.assertIsPhysician).not.toHaveBeenCalled();
      expect(mockClinicalRepo.update).toHaveBeenCalledWith('cr-1', {
        anamnesis: '<p>dor</p>',
        surgicalIndication: true,
      });
    });

    it('desmarcar a indicação não exige médico', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        doctorId: 'nutricionista-1',
        finalizedAt: null,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.update('cr-1', { surgicalIndication: false }, userId);

      expect(mockAccess.assertIsPhysicianWithRegistry).not.toHaveBeenCalled();
    });

    it('atualiza o procedimento quando pertence à clínica', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.update('cr-1', { procedureId: 'proc-1' }, userId);

      expect(mockProcedureRepo.findOne).toHaveBeenCalledWith({
        id: 'proc-1',
      });
      expect(mockClinicalRepo.update).toHaveBeenCalledWith('cr-1', {
        procedureId: 'proc-1',
      });
    });

    it('rejeita procedimento de outra clínica ao atualizar', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
      });
      mockProcedureRepo.findOne.mockResolvedValue({
        id: 'proc-1',
        ownerId: 'outra-clinica',
      });

      await expect(
        service.update('cr-1', { procedureId: 'proc-1' }, userId),
      ).rejects.toThrow(NotFoundException);
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
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

    it.each([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW])(
      'não promove para realizada a consulta em %s',
      async (status) => {
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
        mockAppointmentRepo.findOne.mockResolvedValue({
          id: 'a1',
          ownerId,
          patientId,
          doctorId,
          status,
          cancellationReason: 'paciente desmarcou',
        });

        const result = await service.finalize('cr-1', userId);

        expect(mockClinicalRepo.update).toHaveBeenCalledWith('cr-1', {
          finalizedAt: expect.any(Date),
        });
        expect(result).toMatchObject({ id: 'cr-1' });
        expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
      },
    );

    it('promove a consulta confirmada para realizada', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: 'a1',
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId,
        doctorId,
        status: AppointmentStatus.CONFIRMED,
      });

      await service.finalize('cr-1', userId);

      expect(mockAppointmentRepo.update).toHaveBeenCalledWith('a1', {
        status: AppointmentStatus.COMPLETED,
      });
    });

    it('finaliza sem quebrar quando a consulta vinculada sumiu', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: 'a1',
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });
      mockAppointmentRepo.findOne.mockResolvedValue(null);

      await expect(service.finalize('cr-1', userId)).resolves.toMatchObject({
        id: 'cr-1',
      });
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
      expect(result).toMatchObject({ surgeryRequestId: 'sc-1' });
    });

    it('recusa finalizar ficha com indicação quando o profissional não pode mais indicar cirurgia', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        doctorId,
        finalizedAt: null,
        appointmentId: 'a1',
        surgicalIndication: true,
      });
      mockAccess.assertIsPhysicianWithRegistry.mockRejectedValue(
        new BadRequestException('Preencha o número e a UF do CRM'),
      );

      await expect(service.finalize('cr-1', userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockAccess.assertIsPhysicianWithRegistry).toHaveBeenCalledWith(
        doctorId,
        expect.stringContaining('Desmarque a indicação cirúrgica'),
        expect.any(String),
      );
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
      expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
      expect(mockSurgicalIndication.createForRecord).not.toHaveBeenCalled();
    });

    it('recusa finalizar ficha com indicação quando quem finaliza não é médico', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        doctorId,
        finalizedAt: null,
        appointmentId: 'a1',
        surgicalIndication: true,
      });
      mockAccess.assertIsPhysician.mockRejectedValue(new ForbiddenException());

      await expect(service.finalize('cr-1', userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockAccess.assertIsPhysician).toHaveBeenCalledWith(
        userId,
        expect.stringContaining('Desmarque a indicação cirúrgica'),
      );
      expect(mockClinicalRepo.update).not.toHaveBeenCalled();
      expect(mockSurgicalIndication.createForRecord).not.toHaveBeenCalled();
    });

    it('não confere o registro ao finalizar ficha sem indicação', async () => {
      mockClinicalRepo.findOne.mockResolvedValue({
        id: 'cr-1',
        ownerId,
        finalizedAt: null,
        appointmentId: null,
        surgicalIndication: false,
      });
      mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });

      await service.finalize('cr-1', userId);

      expect(mockAccess.assertIsPhysicianWithRegistry).not.toHaveBeenCalled();
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
      expect(mockClinicalRepo.delete).not.toHaveBeenCalled();
    });

    describe('rascunho de consulta posta em atendimento pela ficha', () => {
      const iniciou = (
        fromStatus: string,
        content = 'Atendimento iniciado',
      ) => ({
        type: 'status_change',
        fromStatus,
        toStatus: AppointmentStatus.IN_PROGRESS,
        content,
      });

      beforeEach(() => {
        mockClinicalRepo.findOne.mockResolvedValue({
          id: 'cr-1',
          ownerId,
          doctorId,
          appointmentId: 'a1',
          finalizedAt: null,
        });
        mockAppointmentRepo.findOne.mockResolvedValue({
          id: 'a1',
          status: AppointmentStatus.IN_PROGRESS,
        });
      });

      it('exclui e devolve a consulta ao status de antes do atendimento, registrando no histórico', async () => {
        mockActivityRepo.findByAppointment.mockResolvedValue([
          { type: 'created' },
          {
            type: 'status_change',
            fromStatus: AppointmentStatus.CONFIRMED,
            toStatus: AppointmentStatus.WAITING,
          },
          iniciou(AppointmentStatus.WAITING),
        ]);

        await service.delete('cr-1', userId);

        expect(mockClinicalRepo.delete).toHaveBeenCalledWith('cr-1');
        expect(mockAppointmentRepo.update).toHaveBeenCalledWith('a1', {
          status: AppointmentStatus.WAITING,
        });
        expect(mockActivityRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            appointmentId: 'a1',
            userId,
            type: 'status_change',
            fromStatus: AppointmentStatus.IN_PROGRESS,
            toStatus: AppointmentStatus.WAITING,
          }),
        );
      });

      it('não mexe na consulta quando a última mudança de status não foi a abertura da ficha', async () => {
        mockActivityRepo.findByAppointment.mockResolvedValue([
          iniciou(AppointmentStatus.SCHEDULED),
          {
            type: 'status_change',
            fromStatus: AppointmentStatus.COMPLETED,
            toStatus: AppointmentStatus.IN_PROGRESS,
            content: null,
          },
        ]);

        await service.delete('cr-1', userId);

        expect(mockClinicalRepo.delete).toHaveBeenCalledWith('cr-1');
        expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
      });

      it('não mexe na consulta posta em atendimento sem histórico (ex.: importação)', async () => {
        mockActivityRepo.findByAppointment.mockResolvedValue([]);

        await service.delete('cr-1', userId);

        expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
        expect(mockActivityRepo.create).not.toHaveBeenCalled();
      });

      it('não mexe na consulta que já saiu de "em atendimento"', async () => {
        mockAppointmentRepo.findOne.mockResolvedValue({
          id: 'a1',
          status: AppointmentStatus.CONFIRMED,
        });

        await service.delete('cr-1', userId);

        expect(mockActivityRepo.findByAppointment).not.toHaveBeenCalled();
        expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
      });

      it('não-médico não exclui o rascunho', async () => {
        mockAccess.assertIsDoctor.mockRejectedValue(new ForbiddenException());

        await expect(service.delete('cr-1', userId)).rejects.toThrow(
          ForbiddenException,
        );
        expect(mockClinicalRepo.delete).not.toHaveBeenCalled();
        expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
      });
    });
  });

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
  describe('status da consulta pela ficha (MIG-03)', () => {
    it('abrir a ficha da consulta leva a consulta para em atendimento', async () => {
      mockClinicalRepo.findOne.mockResolvedValue(null);
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId,
        doctorId,
        status: AppointmentStatus.WAITING,
      });

      await service.create({ patientId, appointmentId: 'a1' }, userId);

      expect(mockAppointmentRepo.update).toHaveBeenCalledWith('a1', {
        status: AppointmentStatus.IN_PROGRESS,
      });
      expect(mockActivityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: 'a1',
          userId,
          type: 'status_change',
          fromStatus: AppointmentStatus.WAITING,
          toStatus: AppointmentStatus.IN_PROGRESS,
          content: 'Atendimento iniciado',
        }),
      );
    });

    it('não mexe em consulta cancelada ao abrir a ficha', async () => {
      mockClinicalRepo.findOne.mockResolvedValue(null);
      mockAppointmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        ownerId,
        patientId,
        doctorId,
        status: AppointmentStatus.CANCELLED,
      });

      await service.create({ patientId, appointmentId: 'a1' }, userId);

      expect(mockAppointmentRepo.update).not.toHaveBeenCalled();
    });

    it.each([AppointmentStatus.WAITING, AppointmentStatus.IN_PROGRESS])(
      'finalizar a ficha fecha a consulta em %s como realizada',
      async (status) => {
        mockClinicalRepo.findOne.mockResolvedValue({
          id: 'cr-1',
          ownerId,
          doctorId,
          appointmentId: 'a1',
          finalizedAt: null,
          surgicalIndication: false,
        });
        mockClinicalRepo.update.mockResolvedValue({ id: 'cr-1' });
        mockAppointmentRepo.findOne.mockResolvedValue({ id: 'a1', status });

        await service.finalize('cr-1', userId);

        expect(mockAppointmentRepo.update).toHaveBeenCalledWith('a1', {
          status: AppointmentStatus.COMPLETED,
        });
        expect(mockActivityRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'status_change',
            toStatus: AppointmentStatus.COMPLETED,
            content: 'Atendimento finalizado',
          }),
        );
      },
    );
  });
});
