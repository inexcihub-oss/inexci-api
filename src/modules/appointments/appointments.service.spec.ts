import {
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

  const mockClinicalRecordRepository = {
    findOne: jest.fn(),
  };

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
    mockAppointmentRepository.hasOverlap.mockResolvedValue(false);
    mockAppointmentRepository.create.mockImplementation((d) =>
      Promise.resolve({ id: 'appt-1', ...d }),
    );

    service = new AppointmentsService(
      mockAppointmentRepository as any,
      mockPatientRepository as any,
      mockClinicalRecordRepository as any,
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
      mockAppointmentRepository.findByPatient.mockResolvedValue([
        { id: 'a-1' },
      ]);

      const result = await service.findByPatient(patientId, userId);

      expect(mockAppointmentRepository.findByPatient).toHaveBeenCalledWith(
        ownerId,
        [doctorId],
        patientId,
      );
      expect(result).toEqual({ total: 1, records: [{ id: 'a-1' }] });
    });
  });

  describe('findOne', () => {
    const appointment = { id: 'appt-1', ownerId, doctorId: 'doctor-2' };

    it('exige acesso ao médico da consulta, não só à clínica', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue(appointment);
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
        mockAppointmentRepository.findOne.mockResolvedValue(appointment);
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

    // D-03: sem zerar a marca, o lembrete "já enviado" era o da data antiga e
    // o paciente nunca era avisado do novo horário.
    it('zera reminderSentAt ao reagendar para outro horário', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue({
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
      mockAppointmentRepository.findOne.mockResolvedValue({
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
      mockAppointmentRepository.findOne.mockResolvedValue({
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
      mockAppointmentRepository.findOne.mockResolvedValue({
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
      mockAppointmentRepository.findOne.mockResolvedValue({
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
        mockAppointmentRepository.findOne.mockResolvedValue({
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
        );
        expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
      },
    );

    it('reativa a consulta quando o horário continua livre', async () => {
      mockAppointmentRepository.findOne.mockResolvedValue({
        id: 'appt-1',
        ownerId,
        doctorId,
        status: AppointmentStatus.CANCELLED,
        scheduledAt: new Date('2026-08-01T14:30:00.000Z'),
        durationMinutes: 30,
      });
      mockAppointmentRepository.hasOverlap.mockResolvedValue(false);
      mockAppointmentRepository.update.mockResolvedValue({ id: 'appt-1' });

      await service.updateStatus(
        'appt-1',
        { status: AppointmentStatus.SCHEDULED },
        userId,
      );

      expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
        status: AppointmentStatus.SCHEDULED,
        cancellationReason: null,
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
        mockAppointmentRepository.findOne.mockResolvedValue({
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
      mockAppointmentRepository.findOne.mockResolvedValue(appointment);
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
      mockAppointmentRepository.findOne.mockResolvedValue(appointment);
      mockClinicalRecordRepository.findOne.mockResolvedValue(null);

      await service.delete('appt-1', userId);

      expect(mockAppointmentRepository.delete).toHaveBeenCalledWith('appt-1');
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
});
