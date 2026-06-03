import { Test, TestingModule } from '@nestjs/testing';
import { PatientNotificationService } from './patient-notification.service';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

jest.mock('src/shared/whatsapp/whatsapp-templates.constants', () => ({
  WHATSAPP_TEMPLATES: {
    STATUS_CHANGE_PATIENT: 'mock-status-sid',
    STALE_STATUS_MESSAGE: 'mock-stale-sid',
    MESSAGE_SCHEDULING_PATIENT: 'mock-scheduling-sid',
    WELCOME_PATIENT: 'mock-welcome-patient-sid',
    WELCOME_USER: 'mock-welcome-user-sid',
  },
}));

describe('PatientNotificationService', () => {
  let service: PatientNotificationService;
  const mockMailService = {
    sendStatusChangePatient: jest.fn().mockResolvedValue(undefined),
  };
  const mockWhatsappService = {
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };

  const baseRequest = {
    id: 'req-1',
    protocol: 'PROT-001',
    surgeryDate: new Date(2026, 5, 2, 6, 0, 0),
    patient: {
      name: 'João Silva',
      email: 'joao@test.com',
      phone: '+5511999999999',
    },
    hospital: { name: 'Hospital ABC' },
    createdBy: { name: 'Dr. Maria' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientNotificationService,
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
      ],
    }).compile();

    service = module.get<PatientNotificationService>(
      PatientNotificationService,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  it('notifyPatient=true → paciente recebe e-mail + WhatsApp (6.4.1)', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockMailService.sendStatusChangePatient).toHaveBeenCalledWith(
      'joao@test.com',
      expect.objectContaining({ patientName: 'João Silva' }),
    );
    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5511999999999',
      'mock-status-sid',
      expect.objectContaining({ '1': 'João Silva' }),
    );
  });

  it('notifyPatient=false → paciente NÃO recebe nada (6.4.1)', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: false,
    });

    expect(mockMailService.sendStatusChangePatient).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('paciente sem e-mail → apenas WhatsApp (se tem telefone) (6.4.1)', async () => {
    const request = {
      ...baseRequest,
      patient: { ...baseRequest.patient, email: undefined },
    };

    await service.notifyPatientStatusChange({
      request,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockMailService.sendStatusChangePatient).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
  });

  it('paciente sem telefone → apenas e-mail (se tem e-mail) (6.4.1)', async () => {
    const request = {
      ...baseRequest,
      patient: { ...baseRequest.patient, phone: undefined },
    };

    await service.notifyPatientStatusChange({
      request,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockMailService.sendStatusChangePatient).toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('paciente sem e-mail e sem telefone → nenhum envio, sem erro (6.4.1)', async () => {
    const request = {
      ...baseRequest,
      patient: { name: 'João Silva', email: undefined, phone: undefined },
    };

    await expect(
      service.notifyPatientStatusChange({
        request,
        oldStatus: SurgeryRequestStatus.SENT,
        newStatus: SurgeryRequestStatus.IN_ANALYSIS,
        notifyPatient: true,
      }),
    ).resolves.toBeUndefined();

    expect(mockMailService.sendStatusChangePatient).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('WhatsApp usa sendTemplate com contentSid (não freeform) (6.4.1)', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      expect.any(String),
      'mock-status-sid', // contentSid
      expect.any(Object),
    );
  });

  it('falha no e-mail não impede envio de WhatsApp (6.4.1)', async () => {
    mockMailService.sendStatusChangePatient.mockRejectedValueOnce(
      new Error('SMTP down'),
    );

    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
  });

  it('status Agendada envia data, horário e hospital no texto ao paciente', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.IN_SCHEDULING,
      newStatus: SurgeryRequestStatus.SCHEDULED,
      notifyPatient: true,
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5511999999999',
      'mock-status-sid',
      expect.objectContaining({
        '3': expect.stringContaining('data 02/06/2026'),
      }),
    );

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5511999999999',
      'mock-status-sid',
      expect.objectContaining({
        '3': expect.stringContaining('horário 06:00'),
      }),
    );

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5511999999999',
      'mock-status-sid',
      expect.objectContaining({
        '3': expect.stringContaining('no Hospital ABC'),
      }),
    );
  });

  it('status Agendada sem hospital não inclui nome de hospital no texto', async () => {
    const request = {
      ...baseRequest,
      hospital: null,
    };

    await service.notifyPatientStatusChange({
      request,
      oldStatus: SurgeryRequestStatus.IN_SCHEDULING,
      newStatus: SurgeryRequestStatus.SCHEDULED,
      notifyPatient: true,
    });

    const [, , variables] = mockWhatsappService.sendTemplate.mock.calls[0];
    expect(variables['3']).not.toContain(' no ');
    expect(variables['3']).toContain('horário 06:00');
  });

  it('opções de agendamento enviam data no formato DD/MM/AAAA', async () => {
    await service.notifyPatientSchedulingOptions({
      request: {
        id: 'req-1',
        patient: { name: 'João Silva', phone: '+5511999999999' },
      },
      dateOptions: [
        '2026-06-12T09:00:00-03:00',
        '2026-06-13T10:30:00-03:00',
        '2026-06-14T11:00:00-03:00',
      ],
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5511999999999',
      'mock-scheduling-sid',
      expect.objectContaining({
        '2': expect.stringContaining('12/06/2026'),
        '3': expect.stringContaining('13/06/2026'),
        '4': expect.stringContaining('14/06/2026'),
      }),
    );
  });
});
