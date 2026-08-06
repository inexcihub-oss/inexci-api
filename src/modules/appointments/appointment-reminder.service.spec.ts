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
      expect.objectContaining({
        patientName: 'Ana',
        doctorName: 'Dr(a). House',
      }),
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

  /**
   * D-07: o nome cadastrado costuma vir com o tratamento ("Dr. Carlos"), e
   * prefixar às cegas produzia "Dr(a). Dr. Carlos" no e-mail e no WhatsApp.
   */
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
    expect(mockWhatsappService.sendAppointmentReminder).toHaveBeenCalledWith(
      '5511999',
      'Ana',
      expect.any(String),
      'Dr. Carlos Mendonça',
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

  // D-04: os envios eram fire-and-forget (`void`), então uma falha de
  // enfileiramento (Redis fora) era engolida e a consulta ficava marcada como
  // lembrada — o lembrete sumia em silêncio.
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
    mockWhatsappService.sendAppointmentReminder.mockRejectedValue(
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
    mockWhatsappService.sendAppointmentReminder.mockResolvedValue(undefined);

    const sent = await service.sendDueReminders();

    expect(sent).toBe(1);
    // A falha do e-mail não pode cancelar o WhatsApp.
    expect(mockWhatsappService.sendAppointmentReminder).toHaveBeenCalled();
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
    // A que falhou fica sem marca, para a próxima execução tentar de novo.
    expect(mockAppointmentRepository.update).not.toHaveBeenCalledWith(
      'appt-1',
      expect.anything(),
    );
    expect(mockAppointmentRepository.update).toHaveBeenCalledWith('appt-2', {
      reminderSentAt: expect.any(Date),
    });
  });
});
