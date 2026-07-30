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
  const mockUserRepository = { findOne: jest.fn() };
  const mockMailService = { sendAppointmentReminder: jest.fn() };
  const mockWhatsappService = { sendAppointmentReminder: jest.fn() };

  const appt = {
    id: 'appt-1',
    patientId: 'p1',
    doctorId: 'd1',
    type: AppointmentType.RETURN,
    status: AppointmentStatus.SCHEDULED,
    scheduledAt: new Date('2026-08-01T17:00:00.000Z'),
    durationMinutes: 30,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRepository.findOne.mockResolvedValue({ id: 'd1', name: 'House' });
    mockAppointmentRepository.update.mockResolvedValue({});
    service = new AppointmentReminderService(
      mockAppointmentRepository as any,
      mockPatientRepository as any,
      mockUserRepository as any,
      mockMailService as any,
      mockWhatsappService as any,
    );
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
      expect.objectContaining({ patientName: 'Ana', doctorName: 'Dr(a). House' }),
    );
    expect(mockWhatsappService.sendAppointmentReminder).toHaveBeenCalledWith(
      '5511999',
      'Ana',
      expect.any(String),
      'Dr(a). House',
    );
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-1', {
      reminderSentAt: expect.any(Date),
    });
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
    expect(mockWhatsappService.sendAppointmentReminder).not.toHaveBeenCalled();
    // Ainda marca para não reprocessar toda hora (idempotência).
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
    // O que falhou não é marcado; o que passou é marcado.
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-2', {
      reminderSentAt: expect.any(Date),
    });
    expect(mockAppointmentRepository.update).not.toHaveBeenCalledWith(
      'appt-1',
      expect.anything(),
    );
  });
});
