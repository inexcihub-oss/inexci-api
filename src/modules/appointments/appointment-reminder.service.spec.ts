import { AppointmentReminderService } from './appointment-reminder.service';
import {
  AppointmentStatus,
  AppointmentType,
} from 'src/database/entities/appointment.entity';

describe('AppointmentReminderService', () => {
  let service: AppointmentReminderService;

  const mockAppointmentRepository = {
    findDueForReminder: jest.fn(),
    update: jest.fn(),
  };
  const mockPatientRepository = { findOne: jest.fn() };
  const mockUserRepository = {
    findOne: jest.fn(),
    isPatientNotificationEnabled: jest.fn(),
  };
  const mockMailService = { sendAppointmentReminder: jest.fn() };
  const mockWhatsappService = { sendAppointmentConfirmation: jest.fn() };

  const appt = {
    id: 'appt-1',
    patientId: 'p1',
    doctorId: 'd1',
    ownerId: 'owner-1',
    type: AppointmentType.RETURN,
    status: AppointmentStatus.SCHEDULED,
    scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
    durationMinutes: 30,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRepository.findOne.mockResolvedValue({ id: 'd1', name: 'House' });
    mockUserRepository.isPatientNotificationEnabled.mockResolvedValue(true);
    mockAppointmentRepository.update.mockResolvedValue({});
    service = new AppointmentReminderService(
      mockAppointmentRepository as any,
      mockPatientRepository as any,
      mockUserRepository as any,
      mockMailService as any,
      mockWhatsappService as any,
    );
  });

  it('lembrete desligado pela clínica: não envia nada, mas marca reminderSentAt (sem nova tentativa)', async () => {
    mockUserRepository.isPatientNotificationEnabled.mockResolvedValue(false);
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([appt]);
    mockPatientRepository.findOne.mockResolvedValue({
      id: 'p1',
      name: 'Ana',
      email: 'ana@x.com',
      phone: '5511999',
    });

    const sent = await service.sendDueReminders();

    expect(sent).toBe(0);
    expect(
      mockUserRepository.isPatientNotificationEnabled,
    ).toHaveBeenCalledWith('owner-1', 'appointmentReminder');
    expect(mockMailService.sendAppointmentReminder).not.toHaveBeenCalled();
    expect(
      mockWhatsappService.sendAppointmentConfirmation,
    ).not.toHaveBeenCalled();
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      reminderSentAt: expect.any(Date),
    });
  });

  it('envia e-mail e WhatsApp quando o paciente tem ambos e marca reminderSentAt', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([appt]);
    mockPatientRepository.findOne.mockResolvedValue({
      id: 'p1',
      name: 'Ana',
      email: 'ana@x.com',
      phone: '5511999',
    });

    const sent = await service.sendDueReminders();

    expect(sent).toBe(1);
    expect(mockMailService.sendAppointmentReminder).toHaveBeenCalledWith(
      'ana@x.com',
      expect.objectContaining({
        patientName: 'Ana',
        doctorName: 'Dr(a). House',
      }),
    );
    expect(
      mockWhatsappService.sendAppointmentConfirmation,
    ).toHaveBeenCalledWith(
      '5511999',
      expect.objectContaining({
        patientName: 'Ana',
        doctorName: 'Dr(a). House',
        when: expect.any(String),
      }),
    );
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      reminderSentAt: expect.any(Date),
    });
  });

  it('não duplica o tratamento quando o nome do médico já o tem', async () => {
    mockUserRepository.findOne.mockResolvedValue({
      id: 'd1',
      name: 'Dr. Carlos Mendonça',
    });
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([appt]);
    mockPatientRepository.findOne.mockResolvedValue({
      id: 'p1',
      name: 'Ana',
      email: 'ana@x.com',
      phone: '5511999',
    });

    await service.sendDueReminders();

    expect(mockMailService.sendAppointmentReminder).toHaveBeenCalledWith(
      'ana@x.com',
      expect.objectContaining({ doctorName: 'Dr. Carlos Mendonça' }),
    );
    expect(
      mockWhatsappService.sendAppointmentConfirmation,
    ).toHaveBeenCalledWith(
      '5511999',
      expect.objectContaining({
        patientName: 'Ana',
        doctorName: 'Dr. Carlos Mendonça',
        when: expect.any(String),
      }),
    );
  });

  it('marca reminderSentAt mesmo sem canais, mas não conta como enviado', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([appt]);
    mockPatientRepository.findOne.mockResolvedValue({
      id: 'p1',
      name: 'Sem Contato',
      email: null,
      phone: null,
    });

    const sent = await service.sendDueReminders();

    expect(sent).toBe(0);
    expect(mockMailService.sendAppointmentReminder).not.toHaveBeenCalled();
    expect(
      mockWhatsappService.sendAppointmentConfirmation,
    ).not.toHaveBeenCalled();
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      reminderSentAt: expect.any(Date),
    });
  });

  it('usa a janela de 24h a partir de agora', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([]);
    const now = new Date('2026-08-01T00:00:00.000Z');

    await service.sendDueReminders(now);

    expect(mockAppointmentRepository.findDueForReminder).toHaveBeenCalledWith(
      now,
      new Date('2026-08-02T00:00:00.000Z'),
    );
  });

  it('continua processando os demais quando um paciente falha', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([
      appt,
      { ...appt, id: 'appt-2', patientId: 'p2' },
    ]);
    mockPatientRepository.findOne
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({
        id: 'p2',
        name: 'Bob',
        email: 'bob@x.com',
        phone: null,
      });

    const sent = await service.sendDueReminders();

    expect(sent).toBe(1);
    expect(mockMailService.sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-2', {
      reminderSentAt: expect.any(Date),
    });
    expect(mockAppointmentRepository.update).not.toHaveBeenCalledWith(
      'appt-1',
      expect.anything(),
    );
  });

  it('não marca reminderSentAt quando todos os canais falham', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([appt]);
    mockPatientRepository.findOne.mockResolvedValue({
      id: 'p1',
      name: 'Ana',
      email: 'ana@x.com',
      phone: '5511999',
    });
    mockMailService.sendAppointmentReminder.mockRejectedValue(
      new Error('redis down'),
    );
    mockWhatsappService.sendAppointmentConfirmation.mockRejectedValue(
      new Error('redis down'),
    );

    const sent = await service.sendDueReminders();

    expect(sent).toBe(0);
    expect(mockAppointmentRepository.update).not.toHaveBeenCalled();
  });

  it('marca reminderSentAt quando ao menos um canal passa', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([appt]);
    mockPatientRepository.findOne.mockResolvedValue({
      id: 'p1',
      name: 'Ana',
      email: 'ana@x.com',
      phone: '5511999',
    });
    mockMailService.sendAppointmentReminder.mockRejectedValue(
      new Error('smtp fora'),
    );
    mockWhatsappService.sendAppointmentConfirmation.mockResolvedValue(
      undefined,
    );

    const sent = await service.sendDueReminders();

    expect(sent).toBe(1);
    expect(mockWhatsappService.sendAppointmentConfirmation).toHaveBeenCalled();
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      reminderSentAt: expect.any(Date),
    });
  });

  it('uma consulta com todos os canais falhando não interrompe o lote', async () => {
    mockAppointmentRepository.findDueForReminder.mockResolvedValue([
      appt,
      { ...appt, id: 'appt-2', patientId: 'p2' },
    ]);
    mockPatientRepository.findOne
      .mockResolvedValueOnce({
        id: 'p1',
        name: 'Ana',
        email: 'ana@x.com',
        phone: null,
      })
      .mockResolvedValueOnce({
        id: 'p2',
        name: 'Bob',
        email: 'bob@x.com',
        phone: null,
      });
    mockMailService.sendAppointmentReminder
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);

    const sent = await service.sendDueReminders();

    expect(sent).toBe(1);
    expect(mockAppointmentRepository.update).not.toHaveBeenCalledWith(
      'appt-1',
      expect.anything(),
    );
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-2', {
      reminderSentAt: expect.any(Date),
    });
  });
});
