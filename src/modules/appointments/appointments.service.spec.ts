import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { APPOINTMENTS_MAX_TAKE } from './dto/find-appointments.dto';

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  const mockAppointmentRepository = {
    findAgenda: jest.fn(),
    countByDoctor: jest.fn(),
    findByPatient: jest.fn(),
    findOneComRelacoes: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    hasOverlap: jest.fn(),
  };

  const mockPatientRepository = {
    findOne: jest.fn(),
  };

  const mockClinicalRecordRepository = {
    findOne: jest.fn(),
    findStatusByAppointmentIds: jest.fn(),
  };

  const mockClinicRepository = {
    findOne: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockClinicRoomRepository = {
    findOne: jest.fn(),
  };

  const mockHealthPlanRepository = {
    findOne: jest.fn(),
  };

  const mockActivityRepository = {
    create: jest.fn(),
    findByAppointment: jest.fn(),
  };
  const mockAvailabilityService = {
    assertNaoBloqueado: jest.fn(),
    foraDaGrade: jest.fn(),
  };

  const mockWhatsappService = {
    sendAppointmentCancelled: jest.fn(),
    sendAppointmentScheduled: jest.fn(),
  };

  const mockPatientNotificationSettings = { isEnabled: jest.fn() };

  const mockAccessControlService = {
    getOwnerId: jest.fn(),
    getAccessibleDoctorIds: jest.fn(),
    canAccessDoctor: jest.fn(),
    assertSameOwner: jest.fn(),
    assertCanAccessDoctorResource: jest.fn(),
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
    mockAccessControlService.assertCanAccessDoctorResource.mockResolvedValue(
      undefined,
    );
    mockPatientRepository.findOne.mockResolvedValue({ id: patientId, ownerId });
    mockClinicalRecordRepository.findOne.mockResolvedValue(null);
    mockClinicalRecordRepository.findStatusByAppointmentIds.mockResolvedValue(
      new Map(),
    );
    mockClinicRepository.findOne.mockResolvedValue({
      id: 'clinic-1',
      ownerId,
    });
    mockAppointmentRepository.hasOverlap.mockResolvedValue(false);
    mockUserRepository.findOne.mockResolvedValue({
      id: doctorId,
      name: 'House',
    });
    mockWhatsappService.sendAppointmentCancelled.mockResolvedValue(undefined);
    mockWhatsappService.sendAppointmentScheduled.mockResolvedValue(undefined);
    mockAppointmentRepository.create.mockImplementation((d) =>
      Promise.resolve({ id: 'appt-1', ...d }),
    );
    mockAppointmentRepository.update.mockImplementation(
      (id: string, d: unknown) => Promise.resolve({ id, ...(d as object) }),
    );

    service = new AppointmentsService(
      mockAppointmentRepository as any,
      mockPatientRepository as any,
      mockClinicalRecordRepository as any,
      mockAccessControlService as any,
      mockClinicRepository as any,
      mockUserRepository as any,
      mockWhatsappService as any,
      mockClinicRoomRepository as any,
      mockHealthPlanRepository as any,
      mockActivityRepository as any,
      mockAvailabilityService as any,
      mockPatientNotificationSettings as any,
    );
    mockPatientNotificationSettings.isEnabled.mockResolvedValue(true);
    mockAvailabilityService.assertNaoBloqueado.mockResolvedValue(undefined);
    mockAvailabilityService.foraDaGrade.mockResolvedValue(false);
    mockActivityRepository.create.mockImplementation((d) =>
      Promise.resolve({ id: 'act-1', ...d }),
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
      mockAppointmentRepository.findByPatient.mockResolvedValue([
        { id: 'a-1' },
      ]);

      const result = await service.findByPatient(patientId, userId);

      expect(mockAppointmentRepository.findByPatient).toHaveBeenCalledWith(
        ownerId,
        [doctorId],
        patientId,
      );
      expect(result).toEqual({
        total: 1,
        records: [{ id: 'a-1', clinicalRecordStatus: null }],
      });
    });
  });

  // "Iniciar" × "Continuar" × "Ver atendimento" sai da ficha, não do status
  // da agenda (que pode ser mexido à mão sem acompanhar a ficha).
  describe('situação da ficha na leitura', () => {
    beforeEach(() => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      mockClinicalRecordRepository.findStatusByAppointmentIds.mockResolvedValue(
        new Map([
          ['a-1', 'draft'],
          ['a-2', 'finalized'],
        ]),
      );
    });

    it('findAgenda anota rascunho, finalizada e sem ficha numa query só', async () => {
      mockAppointmentRepository.findAgenda.mockResolvedValue({
        records: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }],
        total: 3,
      });

      const { records } = await service.findAgenda({} as any, userId);

      expect(records.map((r) => r.clinicalRecordStatus)).toEqual([
        'draft',
        'finalized',
        null,
      ]);
      expect(
        mockClinicalRecordRepository.findStatusByAppointmentIds,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockClinicalRecordRepository.findStatusByAppointmentIds,
      ).toHaveBeenCalledWith(['a-1', 'a-2', 'a-3']);
    });

    it('findOneComFicha traz a situação da ficha da consulta', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'a-1',
        ownerId,
        doctorId,
      });

      const consulta = await service.findOneComFicha('a-1', userId);

      expect(consulta.clinicalRecordStatus).toBe('draft');
    });
  });

  describe('findOne', () => {
    const appointment = { id: 'appt-1', ownerId, doctorId: 'doctor-2' };

    it('exige acesso ao médico da consulta, não só à clínica', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        appointment,
      );
      mockAccessControlService.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.findOne('appt-1', userId)).rejects.toThrow(
        ForbiddenException,
      );

      expect(
        mockAccessControlService.assertCanAccessDoctorResource,
      ).toHaveBeenCalledWith(userId, ownerId, 'doctor-2');
    });

    it.each([
      [
        'cancelar',
        () =>
          service.updateStatus(
            'appt-1',
            { status: AppointmentStatus.CANCELLED },
            userId,
          ),
      ],
      [
        'reagendar',
        () =>
          service.update(
            'appt-1',
            { scheduledAt: '2026-08-02T14:00:00.000Z' },
            userId,
          ),
      ],
      ['excluir', () => service.delete('appt-1', userId)],
    ])(
      'bloqueia %s a consulta de um médico fora do acesso do usuário',
      async (_label, action) => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          appointment,
        );
        mockAccessControlService.assertCanAccessDoctorResource.mockRejectedValue(
          new ForbiddenException(),
        );

        await expect(action()).rejects.toThrow(ForbiddenException);

        expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
        expect(mockAppointmentRepository.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('create', () => {
    it('cria a consulta quando não há conflito', async () => {
      const result = await service.create(baseCreate, userId);

      expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalledWith(
        doctorId,
        new Date('2026-08-01T14:00:00.000Z'),
        new Date('2026-08-01T14:30:00.000Z'),
        undefined,
        {},
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
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        status: AppointmentStatus.SCHEDULED,
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
        { ignorarEncaixes: true },
      );
    });

    it('não revalida conflito quando apenas as notas mudam', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
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

    // D-03: sem zerar a marca, o lembrete "já enviado" era o da data antiga e
    // o paciente nunca era avisado do novo horário.
    it('zera reminderSentAt ao reagendar para outro horário', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        reminderSentAt: new Date('2026-07-31T14:00:00.000Z'),
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.update(
        'appt-1',
        { scheduledAt: '2026-08-05T09:00:00.000Z' },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({
          scheduledAt: new Date('2026-08-05T09:00:00.000Z'),
          reminderSentAt: null,
        }),
      );
    });

    it('não zera reminderSentAt quando o horário enviado é o mesmo', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        reminderSentAt: new Date('2026-07-31T14:00:00.000Z'),
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.update(
        'appt-1',
        { scheduledAt: '2026-08-01T14:00:00.000Z', notes: 'ok' },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
        'appt-1',
        expect.not.objectContaining({ reminderSentAt: null }),
      );
    });

    it('não zera reminderSentAt quando só a duração muda', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        reminderSentAt: new Date('2026-07-31T14:00:00.000Z'),
      });
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.update('appt-1', { durationMinutes: 60 }, userId);

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
        'appt-1',
        expect.not.objectContaining({ reminderSentAt: null }),
      );
    });
  });

  describe('updateStatus', () => {
    it('grava o motivo ao cancelar', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
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
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
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

    // D-01: reabrir uma consulta cancelada devolvia o slot sem checar se ele
    // já tinha sido reocupado — duas consultas ativas no mesmo horário.
    it.each([
      [AppointmentStatus.CANCELLED, AppointmentStatus.SCHEDULED],
      [AppointmentStatus.CANCELLED, AppointmentStatus.CONFIRMED],
      [AppointmentStatus.NO_SHOW, AppointmentStatus.SCHEDULED],
    ])(
      'bloqueia reativar de %s para %s quando o horário foi reocupado',
      async (from, to) => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
          id: 'appt-1',
          ownerId,
          doctorId,
          status: from,
          scheduledAt: new Date('2026-08-01T14:30:00.000Z'),
          durationMinutes: 30,
        });
        mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

        await expect(
          service.updateStatus('appt-1', { status: to }, userId),
        ).rejects.toThrow(ConflictException);

        expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalledWith(
          doctorId,
          new Date('2026-08-01T14:30:00.000Z'),
          new Date('2026-08-01T15:00:00.000Z'),
          'appt-1',
          { ignorarEncaixes: true },
        );
        expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
      },
    );

    it('reativa a consulta quando o horário continua livre', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        status: AppointmentStatus.CANCELLED,
        scheduledAt: new Date('2026-08-01T14:30:00.000Z'),
        durationMinutes: 30,
      });
      mockAppointmentRepository.hasOverlap.mockResolvedValue(false);
      mockUserRepository.findOne.mockResolvedValue({
        id: doctorId,
        name: 'House',
      });
      mockWhatsappService.sendAppointmentCancelled.mockResolvedValue(undefined);
      mockWhatsappService.sendAppointmentScheduled.mockResolvedValue(undefined);
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.SCHEDULED },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
        status: AppointmentStatus.SCHEDULED,
        cancellationReason: null,
        reminderSentAt: null,
      });
    });

    it.each([
      ['realizar', AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED],
      ['cancelar', AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED],
      ['confirmar', AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
      ['faltar', AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW],
    ])(
      'não revalida conflito ao %s (não é reativação)',
      async (_label, from, to) => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
          id: 'appt-1',
          ownerId,
          doctorId,
          status: from,
          scheduledAt: new Date('2026-08-01T14:30:00.000Z'),
          durationMinutes: 30,
        });
        mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

        await service.updateStatus('appt-1', { status: to }, userId);

        expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
      },
    );
  });

  describe('delete', () => {
    const appointment = {
      id: 'appt-1',
      ownerId,
      doctorId,
      status: AppointmentStatus.SCHEDULED,
      scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
      durationMinutes: 30,
    };

    // D-06: sem a consulta, `/atendimento/[appointmentId]` dá 404 e o rascunho
    // clínico fica inalcançável pela UI, mas continua na timeline do paciente.
    it('bloqueia a exclusão quando existe ficha de atendimento vinculada', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        appointment,
      );
      mockClinicalRecordRepository.findOne.mockResolvedValue({ id: 'cr-1' });

      await expect(service.delete('appt-1', userId)).rejects.toThrow(
        ConflictException,
      );

      expect(mockClinicalRecordRepository.findOne).toHaveBeenCalledWith({
        appointmentId: 'appt-1',
      });
      expect(mockAppointmentRepository.delete).not.toHaveBeenCalled();
    });

    it('exclui a consulta sem ficha vinculada', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        appointment,
      );
      mockClinicalRecordRepository.findOne.mockResolvedValue(null);

      await service.delete('appt-1', userId);

      expect(mockAppointmentRepository.delete).toHaveBeenCalledWith('appt-1');
    });
  });

  describe('findAgenda', () => {
    describe('paginação e filtro do hub', () => {
      beforeEach(() => {
        mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
          doctorId,
          'doctor-2',
        ]);
        mockAppointmentRepository.findAgenda.mockResolvedValue({
          records: [],
          total: 48,
        });
        mockAppointmentRepository.countByDoctor.mockResolvedValue({
          [doctorId]: 40,
          'doctor-2': 8,
        });
      });

      it('passa skip e take, limitando a página ao teto', async () => {
        await service.findAgenda({ skip: 20, take: 20 } as any, userId);
        expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
          ownerId,
          [doctorId, 'doctor-2'],
          expect.objectContaining({ skip: 20, take: 20 }),
        );

        await service.findAgenda({ take: 5000 } as any, userId);
        expect(mockAppointmentRepository.findAgenda.mock.calls[1][2].take).toBe(
          1000,
        );
      });

      it('doctorIds filtra só os acessíveis; nenhum acessível = lista vazia', async () => {
        await service.findAgenda(
          { doctorIds: ['doctor-2', 'de-outra-conta'] } as any,
          userId,
        );
        expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
          ownerId,
          ['doctor-2'],
          expect.anything(),
        );

        mockAppointmentRepository.findAgenda.mockClear();
        const vazio = await service.findAgenda(
          { doctorIds: ['de-outra-conta'] } as any,
          userId,
        );
        expect(vazio).toEqual({ total: 0, records: [] });
        expect(mockAppointmentRepository.findAgenda).not.toHaveBeenCalled();
      });

      it('withDoctorCounts devolve a contagem de todos os acessíveis, ignorando o filtro', async () => {
        const result = await service.findAgenda(
          {
            status: ['scheduled'],
            doctorIds: [doctorId],
            withDoctorCounts: true,
          } as any,
          userId,
        );
        expect(mockAppointmentRepository.countByDoctor).toHaveBeenCalledWith(
          ownerId,
          [doctorId, 'doctor-2'],
          expect.objectContaining({ statuses: ['scheduled'] }),
        );
        expect(result).toMatchObject({
          total: 48,
          countByDoctorId: { [doctorId]: 40, 'doctor-2': 8 },
        });
      });

      it('sem withDoctorCounts não conta', async () => {
        const result = await service.findAgenda({} as any, userId);
        expect(mockAppointmentRepository.countByDoctor).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty('countByDoctorId');
      });
    });

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
      mockAppointmentRepository.findAgenda.mockResolvedValue({
        records: [],
        total: 0,
      });

      await service.findAgenda(
        { from: '2026-08-01', to: '2026-08-31', doctorId },
        userId,
      );

      expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
        ownerId,
        [doctorId],
        expect.objectContaining({
          from: new Date('2026-08-01'),
          to: new Date('2026-08-31'),
          take: expect.any(Number),
        }),
      );
    });

    // D-05: antes o filtro era descartado em silêncio e a resposta trazia a
    // agenda de todos os médicos acessíveis, como se o filtro não existisse.
    // Lista vazia (e não 403) para não permitir enumerar ids de médicos.
    it('retorna vazio quando o médico do filtro não é acessível (fail-closed)', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);

      const result = await service.findAgenda(
        { from: '2026-08-01', to: '2026-08-31', doctorId: 'intruder' },
        userId,
      );

      expect(result).toEqual({ total: 0, records: [] });
      expect(mockAppointmentRepository.findAgenda).not.toHaveBeenCalled();
    });

    it('repassa status e ordem para o repositório', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      mockAppointmentRepository.findAgenda.mockResolvedValue({
        records: [],
        total: 0,
      });

      await service.findAgenda(
        {
          status: [AppointmentStatus.COMPLETED],
          order: 'DESC',
        },
        userId,
      );

      expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
        ownerId,
        [doctorId],
        expect.objectContaining({
          statuses: [AppointmentStatus.COMPLETED],
          order: 'DESC',
        }),
      );
    });

    it('deixa a janela aberta quando from/to não vêm na query', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      mockAppointmentRepository.findAgenda.mockResolvedValue({
        records: [],
        total: 0,
      });

      // "Realizadas" lista todo o passado; "Próximas" não tem teto de data.
      await service.findAgenda({}, userId);

      expect(mockAppointmentRepository.findAgenda).toHaveBeenCalledWith(
        ownerId,
        [doctorId],
        expect.objectContaining({ from: undefined, to: undefined }),
      );
    });

    // D-15: o teto de APPOINTMENTS_MAX_TAKE corta a lista em silêncio. Se
    // `total` for o tamanho da página, ele vira o próprio teto e ninguém —
    // nem o frontend, nem o usuário — consegue saber que faltou consulta.
    it('devolve a contagem real do banco, não o tamanho da página cortada', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      const pagina = Array.from({ length: APPOINTMENTS_MAX_TAKE }, (_, i) => ({
        id: `appt-${i}`,
      }));
      mockAppointmentRepository.findAgenda.mockResolvedValue({
        records: pagina,
        total: 1103,
      });

      const result = await service.findAgenda(
        { status: [AppointmentStatus.COMPLETED], order: 'DESC' },
        userId,
      );

      expect(result.total).toBe(1103);
      expect(result.records).toHaveLength(APPOINTMENTS_MAX_TAKE);
      // É a desigualdade que o consumidor usa para avisar do corte.
      expect(result.total).toBeGreaterThan(result.records.length);
    });

    it('mantém total igual ao número de registros quando não há corte', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([
        doctorId,
      ]);
      mockAppointmentRepository.findAgenda.mockResolvedValue({
        records: [{ id: 'appt-1' }, { id: 'appt-2' }],
        total: 2,
      });

      const result = await service.findAgenda({}, userId);

      expect(result.total).toBe(2);
      expect(result.records).toHaveLength(2);
    });
  });

  describe('vínculo com a clínica', () => {
    it('grava o clinicId quando a clínica é da mesma conta', async () => {
      await service.create({ ...baseCreate, clinicId: 'clinic-1' }, userId);

      expect(mockAppointmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ clinicId: 'clinic-1' }),
      );
    });

    it('grava null quando a consulta não tem clínica', async () => {
      await service.create({ ...baseCreate }, userId);

      expect(mockAppointmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ clinicId: null }),
      );
    });

    it('recusa clínica de outra conta com 404', async () => {
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-1',
        ownerId: 'outro-owner',
      });

      await expect(
        service.create({ ...baseCreate, clinicId: 'clinic-1' }, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recusa clínica inexistente com 404', async () => {
      mockClinicRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...baseCreate, clinicId: 'clinic-1' }, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('no update, clínica de outra conta dá 404 antes da checagem de bloqueio', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        clinicId: null,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        status: AppointmentStatus.SCHEDULED,
      });
      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-x',
        ownerId: 'outro-owner',
      });

      await expect(
        service.update('appt-1', { clinicId: 'clinic-x' }, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockAvailabilityService.assertNaoBloqueado).not.toHaveBeenCalled();
    });

    it('desvincula quando o update manda clinicId null', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        clinicId: 'clinic-1',
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        status: AppointmentStatus.SCHEDULED,
      });

      await service.update('appt-1', { clinicId: null }, userId);

      const [, dados] = mockAppointmentRepository.update.mock.calls[0];
      expect(dados.clinicId).toBeNull();
    });

    it('não mexe no vínculo quando o update não menciona clinicId', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        clinicId: 'clinic-1',
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        status: AppointmentStatus.SCHEDULED,
      });

      await service.update('appt-1', { notes: 'obs' }, userId);

      const [, dados] = mockAppointmentRepository.update.mock.calls[0];
      expect(dados).not.toHaveProperty('clinicId');
    });
  });
  // ─── Aviso de cancelamento ao paciente (template appointment_cancelled) ──

  describe('aviso de cancelamento pelo WhatsApp', () => {
    const consultaAgendada = {
      id: 'appt-1',
      ownerId,
      patientId,
      doctorId,
      status: AppointmentStatus.SCHEDULED,
      scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
      durationMinutes: 30,
    };

    beforeEach(() => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        consultaAgendada,
      );
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });
      mockPatientRepository.findOne.mockResolvedValue({
        id: patientId,
        ownerId,
        name: 'Ana Souza',
        phone: '5511998877665',
      });
    });

    it('avisa o paciente quando a clínica cancela a consulta', async () => {
      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CANCELLED },
        userId,
      );

      expect(mockWhatsappService.sendAppointmentCancelled).toHaveBeenCalledWith(
        '5511998877665',
        expect.objectContaining({
          patientName: 'Ana Souza',
          doctorName: 'Dr(a). House',
          when: expect.stringContaining('01/08'),
        }),
      );
    });

    it('não avisa quando a conta desligou o aviso de cancelamento', async () => {
      mockPatientNotificationSettings.isEnabled.mockResolvedValue(false);

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CANCELLED },
        userId,
      );

      expect(mockPatientNotificationSettings.isEnabled).toHaveBeenCalledWith(
        ownerId,
        'appointmentCancelled',
      );
      expect(
        mockWhatsappService.sendAppointmentCancelled,
      ).not.toHaveBeenCalled();
    });

    it('não avisa em mudança de status que não é cancelamento', async () => {
      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.COMPLETED },
        userId,
      );

      expect(
        mockWhatsappService.sendAppointmentCancelled,
      ).not.toHaveBeenCalled();
    });

    /**
     * O paciente já recebeu esse mesmo aviso na tela do WhatsApp quando a
     * consulta foi cancelada; recancelar não é um fato novo para ele.
     */
    it('não reavisa quando a consulta já estava cancelada', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        ...consultaAgendada,
        status: AppointmentStatus.CANCELLED,
      });

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CANCELLED },
        userId,
      );

      expect(
        mockWhatsappService.sendAppointmentCancelled,
      ).not.toHaveBeenCalled();
    });

    it('não avisa paciente sem telefone', async () => {
      mockPatientRepository.findOne.mockResolvedValue({
        id: patientId,
        ownerId,
        name: 'Ana Souza',
        phone: null,
      });

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CANCELLED },
        userId,
      );

      expect(
        mockWhatsappService.sendAppointmentCancelled,
      ).not.toHaveBeenCalled();
    });

    /** Aviso é efeito colateral: Redis fora não pode desfazer o cancelamento. */
    it('cancela mesmo quando o aviso falha', async () => {
      mockWhatsappService.sendAppointmentCancelled.mockRejectedValue(
        new Error('redis down'),
      );

      await expect(
        service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.CANCELLED },
          userId,
        ),
      ).resolves.toBeDefined();

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: null,
      });
    });
  });
  // ─── Aviso de agendamento ao paciente (template appointment_scheduled) ───

  describe('aviso de consulta marcada pelo WhatsApp', () => {
    beforeEach(() => {
      mockPatientRepository.findOne.mockResolvedValue({
        id: patientId,
        ownerId,
        name: 'Ana Souza',
        phone: '5511998877665',
      });
    });

    it('avisa o paciente ao marcar a consulta', async () => {
      await service.create(
        { ...baseCreate, scheduledAt: '2026-08-01T17:00:00.000Z' },
        userId,
      );

      expect(mockWhatsappService.sendAppointmentScheduled).toHaveBeenCalledWith(
        '5511998877665',
        expect.objectContaining({
          patientName: 'Ana Souza',
          doctorName: 'Dr(a). House',
          when: expect.stringContaining('01/08'),
        }),
      );
    });

    it('não avisa quando a conta desligou o aviso de agendamento', async () => {
      mockPatientNotificationSettings.isEnabled.mockResolvedValue(false);

      const criada = await service.create(baseCreate, userId);

      expect(criada).toBeDefined();
      expect(mockPatientNotificationSettings.isEnabled).toHaveBeenCalledWith(
        ownerId,
        'appointmentScheduled',
      );
      expect(
        mockWhatsappService.sendAppointmentScheduled,
      ).not.toHaveBeenCalled();
    });

    it('a falha ao ler a configuração não derruba o agendamento nem envia o aviso', async () => {
      mockPatientNotificationSettings.isEnabled.mockRejectedValue(
        new Error('db fora'),
      );

      await expect(service.create(baseCreate, userId)).resolves.toBeDefined();
      expect(
        mockWhatsappService.sendAppointmentScheduled,
      ).not.toHaveBeenCalled();
    });

    it('não avisa paciente sem telefone', async () => {
      mockPatientRepository.findOne.mockResolvedValue({
        id: patientId,
        ownerId,
        name: 'Ana Souza',
        phone: null,
      });

      await service.create(baseCreate, userId);

      expect(
        mockWhatsappService.sendAppointmentScheduled,
      ).not.toHaveBeenCalled();
    });

    /** Aviso é efeito colateral: a consulta tem de ser criada de qualquer jeito. */
    it('cria a consulta mesmo quando o aviso falha', async () => {
      mockWhatsappService.sendAppointmentScheduled.mockRejectedValue(
        new Error('redis down'),
      );

      await expect(service.create(baseCreate, userId)).resolves.toBeDefined();
      expect(mockAppointmentRepository.create).toHaveBeenCalled();
    });

    // ─── Reagendamento ────────────────────────────────────────────────────

    it('reavisa com a data nova quando a consulta é remarcada', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        patientId,
        doctorId,
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
        durationMinutes: 30,
      });

      await service.update(
        'appt-1',
        { scheduledAt: '2026-08-05T17:00:00.000Z' },
        userId,
      );

      expect(mockWhatsappService.sendAppointmentScheduled).toHaveBeenCalledWith(
        '5511998877665',
        expect.objectContaining({
          patientName: 'Ana Souza',
          doctorName: 'Dr(a). House',
          when: expect.stringContaining('05/08'),
        }),
      );
    });

    /** Mexer em notas ou tipo não é notícia para o paciente. */
    it('não reavisa quando o horário não mudou', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        patientId,
        doctorId,
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
        durationMinutes: 30,
      });

      await service.update('appt-1', { notes: 'trazer exames' }, userId);

      expect(
        mockWhatsappService.sendAppointmentScheduled,
      ).not.toHaveBeenCalled();
    });

    it('não reavisa quando o PATCH repete o mesmo horário', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        patientId,
        doctorId,
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
        durationMinutes: 30,
      });

      await service.update(
        'appt-1',
        { scheduledAt: '2026-08-01T17:00:00.000Z' },
        userId,
      );

      expect(
        mockWhatsappService.sendAppointmentScheduled,
      ).not.toHaveBeenCalled();
    });
  });
  // ─── MIG-03: sala, encaixe, convênio, autor e sala de espera ───
  describe('sala, encaixe, convênio e autor (MIG-03)', () => {
    const sala = (parcial: object = {}) => ({
      id: 'room-1',
      ownerId,
      clinicId: 'clinic-1',
      active: true,
      ...parcial,
    });

    beforeEach(() => {
      mockClinicRoomRepository.findOne.mockResolvedValue(sala());
      mockHealthPlanRepository.findOne.mockResolvedValue({
        id: 'hp-1',
        ownerId,
      });
    });

    it('grava sala, encaixe, convênio e quem agendou', async () => {
      await service.create(
        {
          ...baseCreate,
          clinicId: 'clinic-1',
          roomId: 'room-1',
          healthPlanId: 'hp-1',
          isWalkIn: false,
        },
        userId,
      );

      expect(mockAppointmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          healthPlanId: 'hp-1',
          isWalkIn: false,
          createdById: userId,
        }),
      );
    });

    it('sem nada informado: sem sala, particular, não é encaixe', async () => {
      await service.create(baseCreate, userId);

      expect(mockAppointmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: null,
          healthPlanId: null,
          isWalkIn: false,
          createdById: userId,
        }),
      );
    });

    it('encaixe não passa pela checagem de conflito', async () => {
      mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

      await expect(
        service.create({ ...baseCreate, isWalkIn: true }, userId),
      ).resolves.toBeDefined();
      expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
    });

    it('consulta normal em cima de outra continua dando conflito', async () => {
      mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

      await expect(service.create(baseCreate, userId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('recusa sala de outra clínica, sala sem clínica e sala inativa', async () => {
      mockClinicRoomRepository.findOne.mockResolvedValue(
        sala({ clinicId: 'outra' }),
      );
      await expect(
        service.create(
          { ...baseCreate, clinicId: 'clinic-1', roomId: 'room-1' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      mockClinicRoomRepository.findOne.mockResolvedValue(sala());
      await expect(
        service.create({ ...baseCreate, roomId: 'room-1' }, userId),
      ).rejects.toThrow(BadRequestException);

      mockClinicRoomRepository.findOne.mockResolvedValue(
        sala({ active: false }),
      );
      await expect(
        service.create(
          { ...baseCreate, clinicId: 'clinic-1', roomId: 'room-1' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sala e convênio de outra conta respondem 404', async () => {
      mockClinicRoomRepository.findOne.mockResolvedValue(
        sala({ ownerId: 'outra' }),
      );
      await expect(
        service.create(
          { ...baseCreate, clinicId: 'clinic-1', roomId: 'room-1' },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);

      mockHealthPlanRepository.findOne.mockResolvedValue({
        id: 'hp-1',
        ownerId: 'outra',
      });
      await expect(
        service.create({ ...baseCreate, healthPlanId: 'hp-1' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    describe('update', () => {
      const existente = (parcial: object = {}) => ({
        id: 'appt-1',
        ownerId,
        doctorId,
        patientId,
        clinicId: 'clinic-1',
        roomId: 'room-1',
        isWalkIn: false,
        healthPlanId: null,
        scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
        durationMinutes: 30,
        status: AppointmentStatus.SCHEDULED,
        ...parcial,
      });

      it('trocar de clínica sem mandar sala tira a sala antiga', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          existente(),
        );
        mockClinicRepository.findOne.mockResolvedValue({
          id: 'clinic-2',
          ownerId,
        });

        await service.update('appt-1', { clinicId: 'clinic-2' }, userId);

        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.objectContaining({ clinicId: 'clinic-2', roomId: null }),
        );
      });

      it('remarcar um encaixe não checa conflito', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          existente({ isWalkIn: true }),
        );
        mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

        await service.update(
          'appt-1',
          { scheduledAt: '2026-08-01T15:00:00.000Z' },
          userId,
        );

        expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
      });

      it('deixar de ser encaixe passa a disputar o horário', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          existente({ isWalkIn: true }),
        );
        mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

        await expect(
          service.update('appt-1', { isWalkIn: false }, userId),
        ).rejects.toThrow(ConflictException);
      });

      it('notes null apaga a observação (sem 500)', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          existente({ notes: 'antiga' }),
        );

        await service.update('appt-1', { notes: null }, userId);

        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.objectContaining({ notes: null }),
        );
      });

      // A exclusion constraint ignora encaixes dos dois lados: um encaixe
      // posto sobre a consulta não pode impedir de remarcá-la.
      it('remarcar consulta normal ignora encaixes na checagem de conflito', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          existente(),
        );

        await service.update('appt-1', { durationMinutes: 45 }, userId);

        expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalledWith(
          doctorId,
          expect.any(Date),
          expect.any(Date),
          'appt-1',
          { ignorarEncaixes: true },
        );
      });

      it('troca o convênio e volta para particular', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          existente(),
        );

        await service.update('appt-1', { healthPlanId: null }, userId);

        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.objectContaining({ healthPlanId: null }),
        );
      });
    });
  });

  describe('sala de espera (MIG-03)', () => {
    const consulta = (status: AppointmentStatus, parcial: object = {}) => ({
      id: 'appt-1',
      ownerId,
      doctorId,
      patientId,
      isWalkIn: false,
      scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
      durationMinutes: 30,
      status,
      ...parcial,
    });

    it('marca a chegada (aguardando) sem checar conflito', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        consulta(AppointmentStatus.CONFIRMED),
      );

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.WAITING },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({ status: AppointmentStatus.WAITING }),
      );
      expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
    });

    it('reativar cancelada direto para aguardando checa conflito', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        consulta(AppointmentStatus.CANCELLED),
      );
      mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

      await expect(
        service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.WAITING },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('reativar encaixe cancelado não checa conflito', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        consulta(AppointmentStatus.CANCELLED, { isWalkIn: true }),
      );
      mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

      await expect(
        service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.SCHEDULED },
          userId,
        ),
      ).resolves.toBeDefined();
    });

    it('cancelar a partir de aguardando é permitido (paciente foi embora)', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        consulta(AppointmentStatus.WAITING),
      );

      await service.updateStatus(
        'appt-1',
        {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: 'foi embora',
        },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({ status: AppointmentStatus.CANCELLED }),
      );
    });
  });
  // ─── MIG-04: histórico da consulta ───
  describe('histórico (MIG-04)', () => {
    const tipos = () =>
      mockActivityRepository.create.mock.calls.map(([d]) => d.type);
    const existente = (parcial: object = {}) => ({
      id: 'appt-1',
      ownerId,
      doctorId,
      patientId,
      clinicId: 'clinic-1',
      roomId: null,
      isWalkIn: false,
      healthPlanId: null,
      type: 'return',
      notes: null,
      scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
      durationMinutes: 30,
      status: AppointmentStatus.SCHEDULED,
      ...parcial,
    });

    it('agendar registra a criação, com quem agendou', async () => {
      await service.create({ ...baseCreate, isWalkIn: true }, userId);

      expect(mockActivityRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: 'appt-1',
          userId,
          type: 'created',
          toStatus: AppointmentStatus.SCHEDULED,
          content: expect.stringMatching(
            /^Consulta agendada para .*\(encaixe\)$/,
          ),
        }),
      );
    });

    it('falha ao gravar o histórico não derruba o agendamento', async () => {
      mockActivityRepository.create.mockRejectedValue(new Error('banco'));

      await expect(service.create(baseCreate, userId)).resolves.toBeDefined();
    });

    it('mudança de status registra de/para e o motivo do cancelamento', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.CANCELLED, cancellationReason: ' viagem ' },
        userId,
      );

      expect(mockActivityRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status_change',
          fromStatus: AppointmentStatus.SCHEDULED,
          toStatus: AppointmentStatus.CANCELLED,
          content: 'viagem',
        }),
      );
    });

    it('reenviar o mesmo status não registra nada', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.SCHEDULED },
        userId,
      );

      expect(mockActivityRepository.create).not.toHaveBeenCalled();
    });

    it('remarcar registra o antes e o depois', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );

      await service.update(
        'appt-1',
        { scheduledAt: '2026-08-02T14:00:00.000Z' },
        userId,
      );

      expect(tipos()).toEqual(['rescheduled']);
      expect(mockActivityRepository.create.mock.calls[0][0].content).toMatch(
        /^De .* para .*/,
      );
    });

    it('mudar sala e convênio registra os campos alterados', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );
      mockClinicRoomRepository.findOne.mockResolvedValue({
        id: 'room-1',
        ownerId,
        clinicId: 'clinic-1',
        active: true,
      });
      mockHealthPlanRepository.findOne.mockResolvedValue({
        id: 'hp-1',
        ownerId,
      });

      await service.update(
        'appt-1',
        { roomId: 'room-1', healthPlanId: 'hp-1' },
        userId,
      );

      expect(mockActivityRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updated',
          content: 'Alterou: sala, convênio',
        }),
      );
    });

    it('salvar sem mudar nada não registra nada', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );

      await service.update(
        'appt-1',
        {
          scheduledAt: '2026-08-01T14:00:00.000Z',
          durationMinutes: 30,
          notes: '',
          type: 'return' as never,
        },
        userId,
      );

      expect(mockActivityRepository.create).not.toHaveBeenCalled();
    });

    it('lista o histórico só depois de conferir o acesso à consulta', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );
      mockActivityRepository.findByAppointment.mockResolvedValue([
        { id: 'act-1' },
      ]);

      await expect(service.findActivities('appt-1', userId)).resolves.toEqual([
        { id: 'act-1' },
      ]);
      expect(
        mockAccessControlService.assertCanAccessDoctorResource,
      ).toHaveBeenCalled();
    });

    it('não lista histórico de consulta inexistente', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(null);

      await expect(service.findActivities('x', userId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockActivityRepository.findByAppointment).not.toHaveBeenCalled();
    });

    it('comentário entra aparado, como comentário de quem escreveu', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
        existente(),
      );

      await service.addComment('appt-1', '  paciente pediu remarcar  ', userId);

      expect(mockActivityRepository.create).toHaveBeenCalledWith({
        appointmentId: 'appt-1',
        userId,
        type: 'comment',
        content: 'paciente pediu remarcar',
      });
    });
  });

  describe('disponibilidade (MIG-05)', () => {
    const bloqueado = new ConflictException(
      'Horário bloqueado na agenda do profissional: congresso.',
    );

    it('agendar em horário bloqueado → 409, sem gravar', async () => {
      mockAvailabilityService.assertNaoBloqueado.mockRejectedValue(bloqueado);
      await expect(service.create(baseCreate as any, userId)).rejects.toBe(
        bloqueado,
      );
      expect(mockAppointmentRepository.create).not.toHaveBeenCalled();
      expect(mockAvailabilityService.assertNaoBloqueado).toHaveBeenCalledWith({
        ownerId,
        doctorId,
        clinicId: null,
        start: new Date('2026-08-01T14:00:00.000Z'),
        end: new Date('2026-08-01T14:30:00.000Z'),
      });
    });

    it('encaixe não pula o bloqueio', async () => {
      mockAvailabilityService.assertNaoBloqueado.mockRejectedValue(bloqueado);
      await expect(
        service.create({ ...baseCreate, isWalkIn: true } as any, userId),
      ).rejects.toBe(bloqueado);
      expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
    });

    it('fora da grade cria a consulta e devolve o aviso', async () => {
      mockAvailabilityService.foraDaGrade.mockResolvedValue(true);
      const criada = await service.create(baseCreate as any, userId);
      expect(criada).toMatchObject({
        id: 'appt-1',
        warnings: ['fora_da_grade'],
      });
    });

    it('dentro da grade (ou sem grade) não tem aviso', async () => {
      const criada = await service.create(baseCreate as any, userId);
      expect(criada).not.toHaveProperty('warnings');
    });

    const existente = {
      id: 'appt-9',
      ownerId,
      doctorId,
      patientId,
      clinicId: 'clinic-1',
      status: 'scheduled',
      isWalkIn: false,
      scheduledAt: new Date('2026-08-01T14:00:00.000Z'),
      durationMinutes: 30,
    };

    it('remarcar para horário bloqueado → 409', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(existente);
      mockAvailabilityService.assertNaoBloqueado.mockRejectedValue(bloqueado);
      await expect(
        service.update(
          'appt-9',
          { scheduledAt: '2026-08-02T14:00:00.000Z' } as any,
          userId,
        ),
      ).rejects.toBe(bloqueado);
      expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
    });

    it('a grade é avaliada na clínica da consulta (null sem clínica)', async () => {
      await service.create(
        { ...baseCreate, clinicId: 'clinic-1' } as any,
        userId,
      );
      expect(mockAvailabilityService.foraDaGrade).toHaveBeenLastCalledWith(
        doctorId,
        new Date('2026-08-01T14:00:00.000Z'),
        new Date('2026-08-01T14:30:00.000Z'),
        'clinic-1',
      );

      await service.create(baseCreate as any, userId);
      expect(mockAvailabilityService.foraDaGrade).toHaveBeenLastCalledWith(
        doctorId,
        expect.any(Date),
        expect.any(Date),
        null,
      );
    });

    it('remarcar avalia a grade na clínica atual; trocar de clínica, na nova', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(existente);
      await service.update(
        'appt-9',
        { scheduledAt: '2026-08-02T14:00:00.000Z' } as any,
        userId,
      );
      expect(mockAvailabilityService.foraDaGrade).toHaveBeenLastCalledWith(
        doctorId,
        new Date('2026-08-02T14:00:00.000Z'),
        new Date('2026-08-02T14:30:00.000Z'),
        'clinic-1',
      );

      mockClinicRepository.findOne.mockResolvedValue({
        id: 'clinic-2',
        ownerId,
      });
      await service.update('appt-9', { clinicId: 'clinic-2' } as any, userId);
      expect(mockAvailabilityService.foraDaGrade).toHaveBeenLastCalledWith(
        doctorId,
        existente.scheduledAt,
        expect.any(Date),
        'clinic-2',
      );
    });

    it('editar só as observações não consulta bloqueio nem grade', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(existente);
      await service.update('appt-9', { notes: 'trazer exames' } as any, userId);
      expect(mockAvailabilityService.assertNaoBloqueado).not.toHaveBeenCalled();
      expect(mockAvailabilityService.foraDaGrade).not.toHaveBeenCalled();
    });

    it('reativar consulta cancelada num dia bloqueado → 409', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue({
        ...existente,
        status: 'cancelled',
      });
      mockAvailabilityService.assertNaoBloqueado.mockRejectedValue(bloqueado);
      await expect(
        service.updateStatus('appt-9', { status: 'scheduled' } as any, userId),
      ).rejects.toBe(bloqueado);
    });

    it('cancelar não consulta bloqueio', async () => {
      mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(existente);
      await service.updateStatus(
        'appt-9',
        { status: 'cancelled' } as any,
        userId,
      );
      expect(mockAvailabilityService.assertNaoBloqueado).not.toHaveBeenCalled();
    });
  });
  describe('revisão: ocupação, reativação e ficha finalizada', () => {
    const futuro = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const consulta = (extra: Record<string, unknown> = {}) => ({
      id: 'appt-1',
      ownerId,
      doctorId,
      patientId,
      clinicId: null,
      isWalkIn: false,
      status: AppointmentStatus.SCHEDULED,
      scheduledAt: futuro,
      durationMinutes: 30,
      reminderSentAt: null,
      ...extra,
    });

    describe('updateStatus', () => {
      // Realizada ocupa o horário (OCCUPYING_APPOINTMENT_STATUSES): voltar de
      // cancelada direto para realizada também disputa o slot.
      it('cancelada → realizada revalida conflito e bloqueio', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ status: AppointmentStatus.CANCELLED }),
        );
        mockAppointmentRepository.hasOverlap.mockResolvedValue(true);

        await expect(
          service.updateStatus(
            'appt-1',
            { status: AppointmentStatus.COMPLETED },
            userId,
          ),
        ).rejects.toThrow(ConflictException);
        expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
      });

      it('falta → realizada consulta o bloqueio do dia', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ status: AppointmentStatus.NO_SHOW }),
        );

        await service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.COMPLETED },
          userId,
        );

        expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalled();
        expect(mockAvailabilityService.assertNaoBloqueado).toHaveBeenCalled();
        // Realizada não é reativação para o paciente: sem aviso nem reset.
        expect(
          mockWhatsappService.sendAppointmentScheduled,
        ).not.toHaveBeenCalled();
        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.not.objectContaining({ reminderSentAt: null }),
        );
      });

      it.each([
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.SCHEDULED,
      ])(
        'realizada com ficha finalizada não pode virar %s (409)',
        async (para) => {
          mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
            consulta({ status: AppointmentStatus.COMPLETED }),
          );
          mockClinicalRecordRepository.findOne.mockResolvedValue({
            id: 'rec-1',
            finalizedAt: new Date(),
          });

          await expect(
            service.updateStatus('appt-1', { status: para }, userId),
          ).rejects.toThrow(ConflictException);
          expect(mockClinicalRecordRepository.findOne).toHaveBeenCalledWith({
            appointmentId: 'appt-1',
          });
          expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
        },
      );

      it('realizada com ficha em rascunho pode voltar a ficar em aberto', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ status: AppointmentStatus.COMPLETED }),
        );
        mockClinicalRecordRepository.findOne.mockResolvedValue({
          id: 'rec-1',
          finalizedAt: null,
        });

        await service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.SCHEDULED },
          userId,
        );

        expect(mockAppointmentRepository.update).toHaveBeenCalled();
      });

      it('marcar como realizada sem ficha continua permitido', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta(),
        );

        await service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.COMPLETED },
          userId,
        );

        expect(mockClinicalRecordRepository.findOne).not.toHaveBeenCalled();
        expect(mockAppointmentRepository.update).toHaveBeenCalled();
      });

      // Ficha vinculada (rascunho ou finalizada) atesta o atendimento: a
      // consulta não pode virar cancelada nem falta.
      it.each([
        [AppointmentStatus.IN_PROGRESS, AppointmentStatus.CANCELLED, null],
        [AppointmentStatus.IN_PROGRESS, AppointmentStatus.NO_SHOW, null],
        [AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED, null],
        [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW, null],
        [
          AppointmentStatus.IN_PROGRESS,
          AppointmentStatus.CANCELLED,
          new Date(),
        ],
      ])(
        '%s com ficha (finalizedAt=%#) não pode virar %s (409)',
        async (de, para, finalizedAt) => {
          mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
            consulta({ status: de }),
          );
          mockClinicalRecordRepository.findOne.mockResolvedValue({
            id: 'rec-1',
            finalizedAt,
          });

          await expect(
            service.updateStatus('appt-1', { status: para }, userId),
          ).rejects.toThrow(
            new ConflictException(
              para === AppointmentStatus.CANCELLED
                ? 'Esta consulta já tem uma ficha de atendimento e não pode ser cancelada.'
                : 'Esta consulta já tem uma ficha de atendimento e não pode ser marcada como falta.',
            ),
          );
          expect(mockClinicalRecordRepository.findOne).toHaveBeenCalledWith({
            appointmentId: 'appt-1',
          });
          expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
        },
      );

      it.each([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW])(
        'sem ficha vinculada, %s continua permitido',
        async (para) => {
          mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
            consulta(),
          );

          await service.updateStatus('appt-1', { status: para }, userId);

          expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
            'appt-1',
            expect.objectContaining({ status: para }),
          );
        },
      );

      it('reativar (cancelada → confirmada) zera o lembrete e avisa o paciente', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({
            status: AppointmentStatus.CANCELLED,
            reminderSentAt: new Date(),
          }),
        );
        mockPatientRepository.findOne.mockResolvedValue({
          id: patientId,
          ownerId,
          name: 'Ana',
          phone: '21999990000',
        });

        await service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.CONFIRMED },
          userId,
        );

        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.objectContaining({ reminderSentAt: null }),
        );
        expect(
          mockWhatsappService.sendAppointmentScheduled,
        ).toHaveBeenCalledWith(
          '21999990000',
          expect.objectContaining({ patientName: 'Ana' }),
        );
      });

      it('reativar consulta no passado não avisa o paciente', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({
            status: AppointmentStatus.CANCELLED,
            scheduledAt: new Date('2020-01-01T10:00:00.000Z'),
          }),
        );
        mockPatientRepository.findOne.mockResolvedValue({
          id: patientId,
          ownerId,
          name: 'Ana',
          phone: '21999990000',
        });

        await service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.SCHEDULED },
          userId,
        );

        expect(
          mockWhatsappService.sendAppointmentScheduled,
        ).not.toHaveBeenCalled();
      });

      it('transição entre status em aberto não reavisa nem zera o lembrete', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ reminderSentAt: new Date() }),
        );

        await service.updateStatus(
          'appt-1',
          { status: AppointmentStatus.CONFIRMED },
          userId,
        );

        expect(
          mockWhatsappService.sendAppointmentScheduled,
        ).not.toHaveBeenCalled();
        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.not.objectContaining({ reminderSentAt: null }),
        );
      });

      it('violação da exclusion constraint (23P01) vira a mesma 409', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ status: AppointmentStatus.CANCELLED }),
        );
        mockAppointmentRepository.update.mockRejectedValue(
          Object.assign(new Error('conflicting key value'), {
            driverError: { code: '23P01' },
          }),
        );

        await expect(
          service.updateStatus(
            'appt-1',
            { status: AppointmentStatus.SCHEDULED },
            userId,
          ),
        ).rejects.toThrow(
          new ConflictException(
            'Já existe uma consulta para este médico neste horário.',
          ),
        );
      });
    });

    describe('update', () => {
      it.each([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW])(
        'remarcar consulta %s não checa conflito/bloqueio nem avisa o paciente',
        async (status) => {
          mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
            consulta({ status }),
          );
          mockPatientRepository.findOne.mockResolvedValue({
            id: patientId,
            ownerId,
            name: 'Ana',
            phone: '21999990000',
          });

          await service.update(
            'appt-1',
            {
              scheduledAt: new Date(futuro.getTime() + 3_600_000).toISOString(),
            },
            userId,
          );

          expect(mockAppointmentRepository.hasOverlap).not.toHaveBeenCalled();
          expect(
            mockAvailabilityService.assertNaoBloqueado,
          ).not.toHaveBeenCalled();
          expect(
            mockWhatsappService.sendAppointmentScheduled,
          ).not.toHaveBeenCalled();
        },
      );

      // Realizada continua ocupando o horário: mexer nela ainda disputa o slot
      // (o banco recusaria pela constraint), mas não é aviso de agendamento.
      it('remarcar consulta realizada checa conflito mas não avisa o paciente', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ status: AppointmentStatus.COMPLETED }),
        );
        mockPatientRepository.findOne.mockResolvedValue({
          id: patientId,
          ownerId,
          name: 'Ana',
          phone: '21999990000',
        });

        await service.update(
          'appt-1',
          { scheduledAt: new Date(futuro.getTime() + 3_600_000).toISOString() },
          userId,
        );

        expect(mockAppointmentRepository.hasOverlap).toHaveBeenCalled();
        expect(mockAvailabilityService.assertNaoBloqueado).toHaveBeenCalled();
        expect(
          mockWhatsappService.sendAppointmentScheduled,
        ).not.toHaveBeenCalled();
      });

      it('reenviar a mesma clínica sem sala não derruba a sala', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta({ clinicId: 'clinic-1', roomId: 'room-1' }),
        );

        await service.update('appt-1', { clinicId: 'clinic-1' }, userId);

        expect(mockAppointmentRepository.update).toHaveBeenCalledWith(
          'appt-1',
          expect.not.objectContaining({ roomId: null }),
        );
      });

      it('violação da exclusion constraint (23P01) no update vira 409', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta(),
        );
        mockAppointmentRepository.update.mockRejectedValue(
          Object.assign(new Error('exclusion'), { code: '23P01' }),
        );

        await expect(
          service.update('appt-1', { durationMinutes: 60 }, userId),
        ).rejects.toThrow(ConflictException);
      });

      it('outros erros do banco passam adiante', async () => {
        mockAppointmentRepository.findOneComRelacoes.mockResolvedValue(
          consulta(),
        );
        mockAppointmentRepository.update.mockRejectedValue(
          Object.assign(new Error('boom'), { code: '23505' }),
        );

        await expect(
          service.update('appt-1', { durationMinutes: 60 }, userId),
        ).rejects.toThrow('boom');
      });
    });

    it('create: corrida perdida para a constraint (23P01) vira 409', async () => {
      mockAppointmentRepository.create.mockRejectedValue(
        Object.assign(new Error('exclusion'), {
          driverError: { code: '23P01' },
        }),
      );

      await expect(service.create(baseCreate, userId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('comentário só com espaços → 400, sem gravar', async () => {
      await expect(service.addComment('appt-1', '   ', userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockActivityRepository.create).not.toHaveBeenCalled();
    });
  });
});
